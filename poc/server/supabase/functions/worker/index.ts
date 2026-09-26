import { createClient } from "npm:@supabase/supabase-js@2";
import { isServiceCaller } from "../_shared/auth.ts";
import { SERVER_AUTH } from "../_shared/crypto.ts";
import { gmailFetch, gmailSync, gmailWatch } from "../_shared/gmail-jobs.ts";
import type { Job } from "../_shared/job.ts";
import { withHeartbeat } from "./heartbeat.ts";
import { type Metrics, processItem } from "./process.ts";

// 임대 180초 > Edge 무료 wall-clock 150초. 30초 넘게 걸리는 잡은 하트비트로 연장한다(스펙 §7)
const LEASE_SECONDS = 180;
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, SERVER_AUTH);
// 잡별 측정값(복호화 ms·글자 수). 본문은 담지 않는다
let metrics: Metrics | null = null;
const handlers: Record<string, (job: Job) => Promise<string>> = {
  noop: async () => "done",
  sleep: async (j) => { await new Promise((r) => setTimeout(r, Number(j.payload.ms ?? 0))); return "done"; },
  // PoC-10에서는 복호화 비용만 측정한다. Task 12 Step 3에서 extract를 extractEvent로 교체한다
  process: (j) => processItem(sb, j, async () => "decrypted", (m) => { metrics = m; }),
  "gmail-sync": (j) => gmailSync(sb, j),
  "gmail-fetch": (j) => gmailFetch(sb, j),
  "gmail-watch": (j) => gmailWatch(sb, j),
};
Deno.serve(async (req) => {
  if (!isServiceCaller(req)) return new Response(null, { status: 403 });
  const t0 = performance.now();
  const { data: jobs, error } = await sb.rpc("claim_jobs", { p_limit: 5, p_lease_seconds: LEASE_SECONDS });
  if (error) return new Response(error.code, { status: 500 });
  const results = [];
  for (const j of (jobs ?? []) as Job[]) {
    const tj = performance.now();
    metrics = null;
    try {
      const run = handlers[j.kind] ?? (async () => { throw new Error("unknown kind " + j.kind); });
      const beat = async () => {
        const { data, error } = await sb.rpc("heartbeat_job", { p_id: j.id, p_lease_seconds: LEASE_SECONDS });
        if (error || data !== true) console.log(JSON.stringify({ job_id: j.id, heartbeat: error ? error.code : "lost" }));
      };
      const cp = await withHeartbeat(beat, () => run(j));
      await sb.rpc("complete_job", { p_id: j.id, p_checkpoint: cp });
      results.push([j.id, "done", Math.round(performance.now() - tj), metrics]);
    } catch (e) {
      // 오류 메시지는 코드·식별자만 담도록 각 모듈이 만든다. 길이도 제한한다
      await sb.rpc("fail_job", { p_id: j.id, p_error: (e instanceof Error ? e.message : "error").slice(0, 200) });
      results.push([j.id, "fail", Math.round(performance.now() - tj)]);
    }
  }
  const ms = Math.round(performance.now() - t0);
  console.log(JSON.stringify({ worker: "batch", claimed: jobs?.length ?? 0, ms }));
  return Response.json({ claimed: jobs?.length ?? 0, ms, results });
});
