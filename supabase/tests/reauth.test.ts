import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import type { Job } from "../functions/_shared/job.ts";
import { reauthPayload, reauthPush, type ReauthDeps } from "../functions/worker/reauth.ts";
import { RUN, service as sb, testUser } from "./_testenv.ts";

// ── 순수 ──
function fake(o: { claimed?: boolean; statuses?: (number | "throw")[] } = {}) {
  const calls = { claim: 0, release: 0, sent: [] as unknown[] };
  const statuses = [...(o.statuses ?? [200])];
  const d: ReauthDeps = {
    claim: async () => { calls.claim++; return o.claimed ?? true; },
    release: async () => { calls.release++; },
    listDevices: async () => statuses.map((_, i) => ({ device_id: `d${i}`, apns_token: "a".repeat(64), apns_env: "production" as const })),
    send: async (x) => { calls.sent.push(x.payload); const s = statuses.shift()!; if (s === "throw") throw new Error("GOAWAY"); return { status: s }; },
    topic: () => "com.picpal.eruri",
  };
  return { d, calls };
}
const job = (reason = "expiring"): Job => ({ id: "j1", kind: "gmail-reauth", user_id: "u1", payload: { connection_id: "c1", reason, window_key: "k1" }, attempts: 1, checkpoint: null });

Deno.test("reauth payload: alert without account address; kind gmail_reauth", () => {
  const p = reauthPayload("invalid_grant") as { aps: { alert: { title: string; body: string } }; kind: string };
  assertEquals([p.aps.alert.title, p.kind], ["Gmail 다시 연결 필요", "gmail_reauth"]);
  assert(!JSON.stringify(p).includes("@"));
});
Deno.test("reauth push: sent once per window; already claimed → no send", async () => {
  const a = fake();
  assertEquals(await reauthPush(a.d, job()), "reauth_sent");
  assertEquals([a.calls.claim, a.calls.sent.length], [1, 1]);
  const b = fake({ claimed: false });
  assertEquals(await reauthPush(b.d, job()), "already_sent");
  assertEquals(b.calls.sent.length, 0);
});
Deno.test("reauth push: every device transient → claim released and job retries; permanent rejection is final", async () => {
  const t = fake({ statuses: [503, "throw"] });
  await assertRejects(() => reauthPush(t.d, job()), Error, "gmail-reauth transient");
  assertEquals(t.calls.release, 1);
  const r = fake({ statuses: [410] });
  assertEquals(await reauthPush(r.d, job()), "reauth_rejected");
  assertEquals(r.calls.release, 0);
});
// 리뷰(M1-③a) Minor 8: 기기 0개면 창을 쓰지 않는다(release → 매시 cron 이 다시 넣어 새 기기에 간다). 전부 영구 거절은 도달 0건으로 구분
Deno.test("reauth push: no device → claim released; every device rejected → reauth_rejected (final)", async () => {
  const none = fake({ statuses: [] });
  assertEquals(await reauthPush(none.d, job()), "no_device");
  assertEquals(none.calls.release, 1);
  const rej = fake({ statuses: [410, 400] });
  assertEquals(await reauthPush(rej.d, job()), "reauth_rejected");
  assertEquals(rej.calls.release, 0);
  const mixed = fake({ statuses: [410, 200] });
  assertEquals(await reauthPush(mixed.d, job()), "reauth_sent");
});
Deno.test("reauth push: bad reason is an error", async () => {
  await assertRejects(() => reauthPush(fake().d, job("other")), Error, "bad_reason");
});

// ── 호스팅 DB(전용 테스트 사용자, 자기 연결만) ──
Deno.test("gmail_enqueue_reauth: one job per due connection (scoped), not again after the push is claimed, again when the window changes", async () => {
  const me = (await testUser()).id;
  const { data: conn } = await sb.from("connections").insert({ user_id: me, provider: "gmail", account_ref: `${RUN}-ra-${crypto.randomUUID()}@example.com`,
    status: "active", expires_at: new Date(Date.now() + 3 * 3600_000).toISOString() }).select("id, expires_at").single();
  const P = `${RUN}:`;                                                                             // 워커 cron 이 가져가지 않는 실행 태그
  const enqueue = async () => (await sb.rpc("gmail_enqueue_reauth", { p_user: me, p_lease_prefix: P })).data;
  const jobsFor = async () => (await sb.from("jobs").select("id, payload").eq("lease_key", `${P}reauth:${conn!.id}`)).data!;
  try {
    assertEquals(await enqueue(), 1);
    assertEquals(await enqueue(), 0);                                                              // 대기 중이면 다시 안 넣음
    const [j] = await jobsFor();
    assertEquals(j.payload.reason, "expiring");
    await sb.from("jobs").delete().eq("id", j.id);
    assertEquals((await sb.rpc("claim_reauth_push", { p_user: me, p_connection: conn!.id, p_reason: "expiring", p_window_key: j.payload.window_key })).data, true);
    assertEquals((await sb.rpc("claim_reauth_push", { p_user: me, p_connection: conn!.id, p_reason: "expiring", p_window_key: j.payload.window_key })).data, false);
    assertEquals(await enqueue(), 0);                                                              // 같은 창: 이미 보냄
    await sb.from("connections").update({ expires_at: new Date(Date.now() + 5 * 3600_000).toISOString() }).eq("id", conn!.id);
    assertEquals(await enqueue(), 1);                                                              // 재연결 등으로 창이 바뀜
  } finally {
    await sb.from("jobs").delete().eq("lease_key", `${P}reauth:${conn!.id}`);
    await sb.from("connections").delete().eq("id", conn!.id);                                     // reauth_pushes cascade
  }
});

// 리뷰(M1-③a) Minor 2·3: 창 키는 세션 TimeZone 과 무관한 epoch 초. expires_at 이 없으면(Production 모드) '-' 이고, 재연결(→ active)이 그 연결의 기록을 지워
// 다음 invalid_grant 에 다시 푸시한다
Deno.test("gmail_enqueue_reauth: window_key is epoch seconds; reconnect clears reauth_pushes so a later invalid_grant pushes again", async () => {
  const me = (await testUser()).id;
  const exp = new Date(Date.now() + 3 * 3600_000);
  const { data: conn } = await sb.from("connections").insert({ user_id: me, provider: "gmail", account_ref: `${RUN}-rw-${crypto.randomUUID()}@example.com`,
    status: "active", expires_at: exp.toISOString() }).select("id").single();
  const P = `${RUN}:`;
  const enqueue = async () => (await sb.rpc("gmail_enqueue_reauth", { p_user: me, p_lease_prefix: P })).data;
  const takeJob = async () => {
    const { data } = await sb.from("jobs").delete().eq("lease_key", `${P}reauth:${conn!.id}`).select("payload");
    return data![0].payload as { reason: string; window_key: string };
  };
  const claimPush = async (reason: string, key: string) =>
    (await sb.rpc("claim_reauth_push", { p_user: me, p_connection: conn!.id, p_reason: reason, p_window_key: key })).data;
  try {
    assertEquals(await enqueue(), 1);
    assertEquals((await takeJob()).window_key, String(Math.round(exp.getTime() / 1000)));   // ::bigint 는 반올림
    await sb.from("connections").update({ status: "reauth_required", expires_at: null }).eq("id", conn!.id);
    assertEquals(await enqueue(), 1);
    const j = await takeJob();
    assertEquals([j.reason, j.window_key], ["invalid_grant", "-"]);
    assertEquals(await claimPush("invalid_grant", "-"), true);
    assertEquals(await enqueue(), 0);                                                              // 같은 끊김: 이미 보냄
    await sb.from("connections").update({ status: "active" }).eq("id", conn!.id);                 // 재연결
    const { count } = await sb.from("reauth_pushes").select("*", { count: "exact", head: true }).eq("connection_id", conn!.id);
    assertEquals(count, 0);
    await sb.from("connections").update({ status: "reauth_required" }).eq("id", conn!.id);        // 다시 끊김(expires_at 여전히 null)
    assertEquals(await enqueue(), 1);
  } finally {
    await sb.from("jobs").delete().eq("lease_key", `${P}reauth:${conn!.id}`);
    await sb.from("connections").delete().eq("id", conn!.id);                                     // reauth_pushes cascade
  }
});
