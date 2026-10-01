// M1-①b 게이트(스펙 §15 ①): 합성 항목 1건 → ingest → (cron) worker process → extracted → notify → proposal_pushes 행.
// 기기 행은 가짜 토큰(sandbox)이라 APNs 가 400 BadDeviceToken → rejected 로 끝나도 통과다.
// 전용 테스트 사용자(poc-test-1)·실행 태그만 쓰고, 끝나면 자기 행만 지운다(AGENTS.md §7). 출력은 id·상태·코드만
// deno 테스트와 동시에 돌리지 않는다: 끝의 정리가 같은 테스트 사용자의 usage_counters 를 지운다
// --multi(0.9.0 묶음 알림): 날짜 2개 합성 공지 → facts 2·제안 2, 푸시 기록은 대표(순번 0) 1개뿐, 그 항목 notify 잡 1개면 통과
// --keep: 끝의 정리를 건너뛰고 run·item_id 를 출력한다 → 나중에 --cleanup <run> 으로 그 실행의 행만 지운다(비밀번호를 바꾸지 않는 testUserId)
// 사용: deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/smoke-gate.ts [--multi] [--keep]
//       … smoke-gate.ts --cleanup <run>
import { createClient } from "npm:@supabase/supabase-js@2";
import { SERVER_AUTH } from "../functions/_shared/crypto.ts";
import { seoulToday } from "../functions/_shared/time.ts";
import { MULTI_TEMPLATE, PUSH_TEMPLATE, renderPhrase } from "../eval/phrases.ts";
import { RUN, service as sb, testUser, testUserId } from "../tests/_testenv.ts";

const arg = (k: string) => { const i = Deno.args.indexOf(k); return i >= 0 ? Deno.args[i + 1] : undefined; };
const multi = Deno.args.includes("--multi"), keep = Deno.args.includes("--keep");

// 실행 태그 run 이 만든 행만 지운다: 항목(idempotency_key = NOTIFICATION:<run>:…)과 그 facts·제안·잡, 기기 <run>:…, 테스트 사용자의 사용량·슬롯 행
async function cleanup(userId: string, run: string): Promise<number> {
  const { data: items } = await sb.from("items").select("id").eq("user_id", userId).like("idempotency_key", `NOTIFICATION:${run}:%`);
  const ids = (items ?? []).map((r) => r.id as string);
  for (const itemId of ids) {
    const { data: fs } = await sb.from("facts").select("proposals(id)").eq("user_id", userId).eq("item_id", itemId);
    const pids = (fs ?? []).flatMap((f) => (f.proposals as { id: string }[]).map((p) => p.id));
    await sb.from("facts").delete().eq("user_id", userId).eq("item_id", itemId);          // proposals → proposal_pushes cascade
    await sb.from("jobs").delete().eq("user_id", userId).eq("payload->>item_id", itemId);
    if (pids.length) await sb.from("jobs").delete().eq("user_id", userId).in("lease_key", pids.map((p) => `notify:${p}`));
    await sb.from("items").delete().eq("user_id", userId).eq("id", itemId);
  }
  await sb.from("devices").delete().eq("user_id", userId).like("device_id", `${run}:%`);
  await sb.from("usage_counters").delete().eq("user_id", userId);                           // 테스트 사용자 행만
  await sb.from("llm_slots").delete().eq("user_id", userId);                                // 추출이 LLM 슬롯 행을 만든다
  return ids.length;
}

const cleanupRun = arg("--cleanup");
if (cleanupRun) {
  if (!cleanupRun.startsWith("test:")) throw new Error("cleanup run must be a test: tag");
  console.log(JSON.stringify({ cleanup: cleanupRun, items: await cleanup(await testUserId(1), cleanupRun) }));
  Deno.exit(0);
}

const BASE = Deno.env.get("SUPABASE_URL")!, ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const u = await testUser(1);
const { data: s, error: se } = await createClient(BASE, ANON, SERVER_AUTH).auth.signInWithPassword({ email: u.email, password: u.password });
if (se || !s.session) throw new Error("signin " + se?.code);
const headers = { authorization: `Bearer ${s.session.access_token}`, apikey: ANON, "content-type": "application/json" };
const deviceId = `${RUN}:dev`;
const fakeToken = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
type Push = { status: string; apns_status: number | null; reason: string | null };
type FactRow = { ordinal: number; proposals: { id: string; proposal_pushes: Push[] }[] };
let itemId: string | null = null, proposalId: string | null = null;
try {
  const dev = await fetch(`${BASE}/functions/v1/ingest/device`, { method: "POST", headers,
    body: JSON.stringify({ device_id: deviceId, apns_token: fakeToken, apns_env: "sandbox", build: "gate" }) });
  await dev.body?.cancel();
  if (dev.status !== 200) throw new Error("ingest/device " + dev.status);
  const ing = await fetch(`${BASE}/functions/v1/ingest`, { method: "POST", headers, body: JSON.stringify({
    id: `${RUN}:gate1`, source: "NOTIFICATION", appName: "Slack", title: "ERURI 테스트",
    text: renderPhrase(multi ? MULTI_TEMPLATE : PUSH_TEMPLATE, seoulToday()), capturedAt: new Date().toISOString(), deviceFilter: "rules" }) });
  if (ing.status !== 202) { await ing.body?.cancel(); throw new Error("ingest " + ing.status); }
  itemId = ((await ing.json()) as { item_id: string }).item_id;
  console.log(["device", dev.status, "ingest", ing.status, itemId, RUN].join("\t"));
  const t0 = Date.now();
  let status = "", push: Push | null = null, facts: FactRow[] = [];
  while (Date.now() - t0 < 300_000 && (push === null || ["sending", "failed"].includes(push.status))) {   // sending·failed 는 중간 상태(재시도)
    await new Promise((r) => setTimeout(r, 10_000));
    status = (await sb.from("items").select("status").eq("id", itemId).eq("user_id", u.id).single()).data?.status ?? "";
    const { data } = await sb.from("facts").select("ordinal, proposals(id, proposal_pushes(status, apns_status, reason))").eq("user_id", u.id)
      .eq("item_id", itemId).order("ordinal");
    facts = (data ?? []) as FactRow[];
    const p = facts[0]?.proposals?.[0];                                                     // 대표(순번 0)
    proposalId = p?.id ?? proposalId;
    push = p?.proposal_pushes?.[0] ?? null;
    console.log([`t+${Math.round((Date.now() - t0) / 1000)}s`, status, proposalId ?? "-", push?.status ?? "-"].join("\t"));
  }
  const proposals = facts.flatMap((f) => f.proposals);
  const pushed = proposals.filter((p) => p.proposal_pushes.length > 0);
  let ok = status === "extracted" && proposalId !== null && push !== null && ["sent", "rejected"].includes(push.status);
  const counts: Record<string, number> = {};
  if (multi) {
    // 묶음: 푸시 기록은 대표 하나(기기별 1회 키 = 대표 id), notify 잡도 대표 하나
    const { count } = await sb.from("jobs").select("id", { count: "exact", head: true }).eq("user_id", u.id)
      .in("lease_key", proposals.map((p) => `notify:${p.id}`));
    Object.assign(counts, { facts: facts.length, proposals: proposals.length, pushed_proposals: pushed.length, notify_jobs: count ?? 0 });
    ok = status === "extracted" && facts.length === 2 && proposals.length === 2 && pushed.length === 1 && pushed[0].id === proposalId
      && push?.status === "rejected" && push?.apns_status === 400 && count === 1;
  }
  console.log(JSON.stringify({ gate: ok ? "pass" : "fail", ...(keep ? { run: RUN } : {}), item_id: itemId, status, proposal_id: proposalId, push, ...counts }));
  if (!ok) Deno.exitCode = 1;
} finally {
  if (!keep) await cleanup(u.id, RUN);
}
