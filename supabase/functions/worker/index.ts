import { createClient } from "npm:@supabase/supabase-js@2";
import { isServiceCaller } from "../_shared/auth.ts";
import { SERVER_AUTH } from "../_shared/crypto.ts";
import { classifierOrNone } from "../_shared/classifier-env.ts";
import { classifyThreshold } from "../_shared/classify.ts";
import { gmailFetch, gmailSync, gmailWatch } from "../_shared/gmail-jobs.ts";
import type { Job } from "../_shared/job.ts";
import { extractMedia } from "./extract.ts";
import { withHeartbeat } from "./heartbeat.ts";
import { mediaDeps } from "./media-deps.ts";
import { notifyProposal } from "./notify.ts";
import { notifyDeps } from "./notify-deps.ts";
import { type Metrics, processText } from "./text.ts";
import { textDeps } from "./text-deps.ts";

// 임대 180초 > Edge 무료 wall-clock 150초. 30초 넘게 걸리는 잡은 하트비트로 연장한다(스펙 §7)
const LEASE_SECONDS = 180;
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, SERVER_AUTH);
// 잡별 측정값(복호화 ms·글자 수). 본문은 담지 않는다
let metrics: Metrics | null = null;
const media = mediaDeps(sb);
const env = (k: string) => Deno.env.get(k);
// 분류 게이트(스펙 §7 0b, Jev). 설정이 잘못돼도 워커 전체를 멈추지 않고 none 으로 돈다(오류 코드는 로그)
const text = textDeps(sb, { classifier: classifierOrNone(env), threshold: classifyThreshold(env) });
const notify = notifyDeps(sb);
const handlers: Record<string, (job: Job) => Promise<string>> = {
  noop: async () => "done",
  sleep: async (j) => { await new Promise((r) => setTimeout(r, Number(j.payload.ms ?? 0))); return "done"; },
  // 텍스트(스펙 §7 0b): 규칙 재적용 → 분류 게이트 → 추출 → save_fact. 로그에는 코드·개수만
  process: (j) => processText(text, j, (m) => { metrics = m; }),
  // 이미지·PDF(스펙 §7): Storage → vision(월 100건) → 초과 시 OCR 텍스트 → facts·proposals
  extract: (j) => extractMedia(media, j),
  // 제안 푸시(스펙 §7 notify 0b): 기기별 1회
  notify: (j) => notifyProposal(notify, j),
  "gmail-sync": (j) => gmailSync(sb, j),
  "gmail-fetch": (j) => gmailFetch(sb, j),
  "gmail-watch": (j) => gmailWatch(sb, j),
};
Deno.serve(async (req) => {
  if (!isServiceCaller(req)) return new Response(null, { status: 403 });
  const t0 = performance.now();
  // 배포 함수 실측용: secret 키 호출이 'test:' 실행 태그를 주면 그 테스트 잡만 가져간다(cron 호출은 본문 없음 → 테스트 잡 제외)
  const body = await req.json().catch(() => ({})) as { lease_prefix?: unknown };
  const prefix = typeof body.lease_prefix === "string" && body.lease_prefix.startsWith("test:") ? body.lease_prefix : null;
  const { data: jobs, error } = await sb.rpc("claim_jobs", { p_limit: 5, p_lease_seconds: LEASE_SECONDS, p_lease_prefix: prefix });
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
