import { assert, assertEquals } from "jsr:@std/assert";
import { encrypt, toBytea } from "../functions/_shared/crypto.ts";
import type { Job } from "../functions/_shared/job.ts";
import { extractMedia } from "../functions/worker/extract.ts";
import { mediaDeps } from "../functions/worker/media-deps.ts";
import { deleteRunJobs, RUN, service as sb, testUser } from "./_testenv.ts";

// 호스팅 DB. 전용 테스트 사용자·실행 태그만 쓰고 자기 행만 지운다(AGENTS.md §7). 모델 호출은 가짜(합성 결과)
const USER = (await testUser()).id;
const month = async () => (await sb.rpc("seoul_month")).data as string;
async function setVisionCalls(n: number) {
  const { error } = await sb.from("usage_counters").upsert({ user_id: USER, month: await month(), vision_calls: n });
  assertEquals(error, null);
}
async function counter() {
  const { data } = await sb.from("usage_counters").select("vision_calls, extract_tokens").eq("user_id", USER).eq("month", await month()).single();
  return data as { vision_calls: number; extract_tokens: number };
}
const clearCounters = () => sb.from("usage_counters").delete().eq("user_id", USER);

Deno.test("reserve_vision_call: 99 → true (100), then false; counter never exceeds the monthly limit", async () => {
  await setVisionCalls(99);
  assertEquals((await sb.rpc("reserve_vision_call", { p_user: USER, p_limit: 100 })).data, true);
  const [a, b] = await Promise.all([1, 2].map(() => sb.rpc("reserve_vision_call", { p_user: USER, p_limit: 100 })));
  assertEquals([a.data, b.data], [false, false]);
  assertEquals((await counter()).vision_calls, 100);
  await clearCounters();
  assertEquals((await sb.rpc("reserve_vision_call", { p_user: USER, p_limit: 100 })).data, true);   // 새 달 행이 없으면 1로 생성
  assertEquals((await counter()).vision_calls, 1);
  await clearCounters();
});

async function seedMedia(ext: "png" | "pdf", ocr: string | null) {
  const path = `${USER}/${RUN.replace(":", "-")}-${crypto.randomUUID().slice(0, 6)}.${ext}`;
  const up = await sb.storage.from("media").upload(path, new Uint8Array([137, 80, 78, 71]), { contentType: ext === "pdf" ? "application/pdf" : "image/png" });
  assertEquals(up.error, null);
  const { data: itemId, error } = await sb.rpc("insert_media_item", { p_user: USER, p_source: "SHARE", p_idempotency_key: `${RUN}:media:${path}`,
    p_storage_key: `media/${path}`, p_ocr_text_enc: ocr === null ? null : toBytea(await encrypt(USER, ocr)),
    p_occurred_at: new Date().toISOString(), p_lease_key: `${RUN}:extract:${path}` });
  assertEquals(error, null);
  return { itemId: itemId as string, path };
}
async function cleanup(itemIds: string[], paths: string[]) {
  await sb.from("facts").delete().eq("user_id", USER).in("item_id", itemIds);    // proposals cascade
  await sb.from("items").delete().eq("user_id", USER).in("id", itemIds);
  await sb.storage.from("media").remove(paths);
  await deleteRunJobs();
  await clearCounters();
}
const fakeEvent = { title: "합성 결혼식", start: "2026-10-17T13:00:00+09:00", end: null, location: "합성홀", uncertain: [] as string[] };

Deno.test("extract job end-to-end on hosted DB: vision under cap, OCR fallback over cap, fact + proposal saved once", async () => {
  const a = await seedMedia("png", "합성 OCR: 2026년 10월 17일 오후 1시 합성홀");
  const b = await seedMedia("pdf", "합성 OCR: 안내문");
  const seen: string[][] = [];
  const deps = mediaDeps(sb, async (input) => { seen.push(Object.keys(input).sort()); return { event: fakeEvent, usage: { input_tokens: 900, output_tokens: 40 } }; }, { leasePrefix: `${RUN}:` });
  try {
    const { data: jobs, error } = await sb.rpc("claim_jobs", { p_limit: 5, p_lease_seconds: 60, p_lease_prefix: `${RUN}:extract` });
    assertEquals(error, null);
    assertEquals((jobs as Job[]).length, 2);
    const byItem = new Map((jobs as Job[]).map((j) => [String(j.payload.item_id), j]));
    assertEquals(byItem.get(a.itemId)!.kind, "extract");

    await setVisionCalls(99);                                                          // 이번 달 99건 사용 상태
    assertEquals(await extractMedia(deps, byItem.get(a.itemId)!), "proposed");          // 100번째 → vision
    assertEquals(await extractMedia(deps, byItem.get(b.itemId)!), "proposed");          // 101번째 → OCR 폴백
    assertEquals(seen, [["imageBase64", "mediaType", "ocrText"], ["ocrText"]]);
    assertEquals(await counter(), { vision_calls: 100, extract_tokens: 1880 });

    const { data: facts } = await sb.from("facts").select("id, item_id, kind, payload, proposals(action, status, payload, idempotency_key)")
      .eq("user_id", USER).in("item_id", [a.itemId, b.itemId]);
    assertEquals(facts!.length, 2);
    const fa = facts!.find((f) => f.item_id === a.itemId)!;
    assertEquals([fa.kind, fa.payload.via, fa.payload.start], ["event", "vision", fakeEvent.start]);
    assertEquals(facts!.find((f) => f.item_id === b.itemId)!.payload.via, "ocr");
    const p = (fa.proposals as { action: string; status: string; payload: Record<string, unknown>; idempotency_key: string }[]);
    assertEquals([p.length, p[0].action, p[0].status, "via" in p[0].payload], [1, "create_event", "proposed", false]);

    // 재시도(같은 잡을 다시 실행)해도 fact·proposal은 1건
    await extractMedia(deps, byItem.get(a.itemId)!);
    const again = await sb.from("proposals").select("id", { count: "exact", head: true }).eq("fact_id", fa.id);
    assertEquals(again.count, 1);
    const { data: item } = await sb.from("items").select("status").eq("id", a.itemId).single();
    assertEquals(item!.status, "extracted");

    // OCR 복호화 감사가 남는다
    const { count } = await sb.from("audit_log").select("id", { count: "exact", head: true }).eq("user_id", USER).eq("target", a.itemId).eq("action", "decrypt");
    assert((count ?? 0) >= 1);
  } finally {
    await cleanup([a.itemId, b.itemId], [a.path, b.path]);
  }
});

Deno.test("worker_get_media refuses another user's item (owner check)", async () => {
  const other = (await testUser(2)).id;
  const a = await seedMedia("png", null);
  try {
    const { data, error } = await sb.rpc("worker_get_media", { p_user: other, p_item: a.itemId });
    assertEquals([error, (data as unknown[]).length], [null, 0]);
  } finally {
    await cleanup([a.itemId], [a.path]);
  }
});
