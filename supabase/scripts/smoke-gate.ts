// M1-①b 게이트(스펙 §15 ①): 합성 항목 1건 → ingest → (cron) worker process → extracted → notify → proposal_pushes 행.
// 기기 행은 가짜 토큰(sandbox)이라 APNs 가 400 BadDeviceToken → rejected 로 끝나도 통과다.
// 전용 테스트 사용자(poc-test-1)·실행 태그만 쓰고, 끝나면 자기 행만 지운다(AGENTS.md §7). 출력은 id·상태·코드만
// 사용: deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/smoke-gate.ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { SERVER_AUTH } from "../functions/_shared/crypto.ts";
import { seoulToday } from "../functions/_shared/time.ts";
import { PUSH_TEMPLATE, renderPhrase } from "../eval/phrases.ts";
import { RUN, service as sb, testUser } from "../tests/_testenv.ts";

const BASE = Deno.env.get("SUPABASE_URL")!, ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const u = await testUser(1);
const { data: s, error: se } = await createClient(BASE, ANON, SERVER_AUTH).auth.signInWithPassword({ email: u.email, password: u.password });
if (se || !s.session) throw new Error("signin " + se?.code);
const headers = { authorization: `Bearer ${s.session.access_token}`, apikey: ANON, "content-type": "application/json" };
const deviceId = `${RUN}:dev`;
const fakeToken = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
type Push = { status: string; apns_status: number | null; reason: string | null };
let itemId: string | null = null, proposalId: string | null = null;
try {
  const dev = await fetch(`${BASE}/functions/v1/ingest/device`, { method: "POST", headers,
    body: JSON.stringify({ device_id: deviceId, apns_token: fakeToken, apns_env: "sandbox", build: "gate" }) });
  await dev.body?.cancel();
  const ing = await fetch(`${BASE}/functions/v1/ingest`, { method: "POST", headers, body: JSON.stringify({
    id: `${RUN}:gate1`, source: "NOTIFICATION", appName: "Slack", title: "ERURI 테스트",
    text: renderPhrase(PUSH_TEMPLATE, seoulToday()), capturedAt: new Date().toISOString(), deviceFilter: "rules" }) });
  itemId = ((await ing.json()) as { item_id: string }).item_id;
  console.log(["device", dev.status, "ingest", ing.status, itemId].join("\t"));
  const t0 = Date.now();
  let status = "", push: Push | null = null;
  while (Date.now() - t0 < 300_000 && push === null) {
    await new Promise((r) => setTimeout(r, 10_000));
    status = (await sb.from("items").select("status").eq("id", itemId).eq("user_id", u.id).single()).data?.status ?? "";
    const { data } = await sb.from("facts").select("proposals(id, proposal_pushes(status, apns_status, reason))").eq("user_id", u.id).eq("item_id", itemId);
    const p = (data?.[0]?.proposals as { id: string; proposal_pushes: Push[] }[] | undefined)?.[0];
    proposalId = p?.id ?? proposalId;
    push = p?.proposal_pushes?.[0] ?? null;
    console.log([`t+${Math.round((Date.now() - t0) / 1000)}s`, status, proposalId ?? "-", push?.status ?? "-"].join("\t"));
  }
  const ok = status === "extracted" && proposalId !== null && push !== null && ["sent", "rejected"].includes(push.status);
  console.log(JSON.stringify({ gate: ok ? "pass" : "fail", item_id: itemId, status, proposal_id: proposalId, push }));
  if (!ok) Deno.exitCode = 1;
} finally {
  if (itemId) {
    await sb.from("facts").delete().eq("user_id", u.id).eq("item_id", itemId);          // proposals → proposal_pushes cascade
    await sb.from("jobs").delete().eq("user_id", u.id).eq("payload->>item_id", itemId);
    if (proposalId) await sb.from("jobs").delete().eq("user_id", u.id).eq("lease_key", `notify:${proposalId}`);
    await sb.from("items").delete().eq("user_id", u.id).eq("id", itemId);
  }
  await sb.from("devices").delete().eq("user_id", u.id).eq("device_id", deviceId);
  await sb.from("usage_counters").delete().eq("user_id", u.id);                           // 테스트 사용자 행만
}
