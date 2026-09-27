// PoC-8 서버 부분(Task 12 Step 3) 배포 worker 실측: 전용 테스트 사용자·'test:<run>' 잡만 사용(cron은 테스트 잡을 가져가지 않는다).
// 1) 합성 7종 → insert_media_item(extract 잡) → 배포 worker { lease_prefix } 호출 → facts·proposals·usage_counters 확인
// 2) 합성 텍스트 3건 → process 잡 → checkpoint 'extracted' (계획서 seed-items 3 확인의 테스트 사용자판)
// 끝나면 이번 실행이 만든 행·파일만 지운다. 사용: cd poc/server && deno run -A --env-file=.env eval/run-worker-extract.ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { encrypt, SERVER_AUTH, toBytea } from "../supabase/functions/_shared/crypto.ts";
import { RUN, testUser } from "../supabase/tests/_testenv.ts";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = createClient(URL_, KEY, SERVER_AUTH);
const dir = new URL("./images/", import.meta.url);
const truth: Record<string, { start: string }> = JSON.parse(await Deno.readTextFile(new URL("truth.json", dir)));
const ocr: Record<string, string> = JSON.parse(await Deno.readTextFile(new URL("ocr.json", dir)));
const user = (await testUser()).id;
const tag = RUN.replace(":", "-");
const items: string[] = [], paths: string[] = [];

async function runWorker() {
  const t0 = performance.now();
  const r = await fetch(`${URL_}/functions/v1/worker`, { method: "POST", headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ lease_prefix: RUN }) });
  const j = await r.json();
  return { status: r.status, ms: Math.round(performance.now() - t0), claimed: j.claimed, results: (j.results as unknown[][]).map((x) => [x[1], x[2]]) };
}

try {
  for (const name of Object.keys(truth)) {
    const path = `${user}/${tag}/${name}`;
    const up = await sb.storage.from("poc").upload(path, await Deno.readFile(new URL(name, dir)), { contentType: name.endsWith(".pdf") ? "application/pdf" : "image/png" });
    if (up.error) throw new Error("upload " + up.error.message);
    paths.push(path);
    const { data, error } = await sb.rpc("insert_media_item", { p_user: user, p_source: "SHARE", p_idempotency_key: `${RUN}:media:${name}`,
      p_storage_key: `poc/${path}`, p_ocr_text_enc: toBytea(await encrypt(user, ocr[name])), p_occurred_at: new Date().toISOString(),
      p_lease_key: `${RUN}:extract:${name}` });
    if (error) throw new Error("insert_media_item " + error.code);
    items.push(data as string);
  }
  for (let i = 0; i < 3; i++) {
    const text = `합성 문자 ${i}: 다음 주 ${10 + i}월 ${3 + i}일 오후 ${2 + i}시 합성치과 스케일링 예약이 확정되었습니다.`;
    const { data, error } = await sb.rpc("insert_item", { p_user: user, p_source: "MESSAGES", p_idempotency_key: `${RUN}:text:${i}`,
      p_sender: null, p_title: "합성", p_content_enc: toBytea(await encrypt(user, text)), p_occurred_at: new Date().toISOString(), p_enqueue: false });
    if (error) throw new Error("insert_item " + error.code);
    items.push(data as string);
    const j = await sb.from("jobs").insert({ kind: "process", user_id: user, lease_key: `${RUN}:process:${i}`, payload: { item_id: data } });
    if (j.error) throw new Error("jobs insert " + j.error.code);
  }
  const batches = [];
  for (let k = 0; k < 3; k++) batches.push(await runWorker());          // 10잡 / 배치 5
  console.log(JSON.stringify(batches));
  const { data: jobs } = await sb.from("jobs").select("kind, status, checkpoint, attempts, last_error").like("lease_key", RUN + "%");
  console.log(JSON.stringify(jobs));
  const { data: facts } = await sb.from("facts").select("item_id, payload, proposals(action, status)").eq("user_id", user).in("item_id", items);
  let startOk = 0;
  for (const f of facts ?? []) {
    const name = Object.keys(truth)[items.indexOf(f.item_id)];
    const ok = Date.parse(f.payload.start) === Date.parse(truth[name].start) || (f.payload.uncertain as string[]).includes("date");
    if (ok) startOk++;
    console.log(name, f.payload.via, ok ? "start ok" : "start MISS", JSON.stringify(f.payload.uncertain), JSON.stringify(f.proposals));
  }
  const { data: usage } = await sb.from("usage_counters").select("vision_calls, extract_tokens").eq("user_id", user);
  console.log(JSON.stringify({ facts: facts?.length, startOk, usage }));
} finally {
  await sb.from("facts").delete().eq("user_id", user).in("item_id", items);
  await sb.from("items").delete().eq("user_id", user).in("id", items);
  await sb.storage.from("poc").remove(paths);
  await sb.from("jobs").delete().like("lease_key", RUN + "%");
  await sb.from("usage_counters").delete().eq("user_id", user);
  console.log("cleaned", items.length, "items");
}
