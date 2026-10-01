import { createClient } from "npm:@supabase/supabase-js@2";
import { isServiceCaller } from "../_shared/auth.ts";
import { SERVER_AUTH } from "../_shared/crypto.ts";
import { classifierOrNone } from "../_shared/classifier-env.ts";
import { classifyThreshold } from "../_shared/classify.ts";
import { gmailFetch, gmailSync, gmailWatch } from "../_shared/gmail-jobs.ts";
import type { Job } from "../_shared/job.ts";
import { nextDeferredWait, runBatches, SOON_WINDOW_MS } from "./batch.ts";
import { embedItem } from "./embed.ts";
import { embedDeps } from "./embed-deps.ts";
import { extractMedia } from "./extract.ts";
import { mediaDeps } from "./media-deps.ts";
import { notifyProposal } from "./notify.ts";
import { notifyDeps } from "./notify-deps.ts";
import { purgeMedia } from "./purge.ts";
import { reauthPush } from "./reauth.ts";
import { reauthDeps } from "./reauth-deps.ts";
import { runJob } from "./run.ts";
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
const reauth = reauthDeps(sb);
const emb = embedDeps(sb);
const handlers: Record<string, (job: Job) => Promise<string>> = {
  noop: async () => "done",
  sleep: async (j) => { await new Promise((r) => setTimeout(r, Number(j.payload.ms ?? 0))); return "done"; },
  // 텍스트(스펙 §7 0b): 규칙 재적용 → 분류 게이트 → 추출 → save_fact. 로그에는 코드·개수만
  process: (j) => processText(text, j, (m) => { metrics = m; }),
  // 청크·임베딩(스펙 §7): 제목+본문 512자 청크 → text-embedding-3-large 512 → item_chunks. process 잡이 저장·empty 뒤에 넣는다
  embed: (j) => embedItem(emb, j),
  // 이미지·PDF(스펙 §7): Storage → vision(월 100건) → 초과 시 OCR 텍스트 → facts·proposals
  extract: (j) => extractMedia(media, j),
  // 제안 푸시(스펙 §7 notify 0b): 기기별 1회
  notify: (j) => notifyProposal(notify, j),
  "gmail-sync": (j) => gmailSync(sb, j),
  "gmail-fetch": (j) => gmailFetch(sb, j),
  "gmail-watch": (j) => gmailWatch(sb, j),
  // 재인증 푸시(스펙 §7): 연결·사유·만료 창마다 1회
  "gmail-reauth": (j) => reauthPush(reauth, j),
  // 원문 만료(스펙 §8): 기한 지난 이미지·PDF 의 Storage 객체. purge-expired-daily cron 이 넣는다
  "purge-media": () => purgeMedia(sb),
};
Deno.serve(async (req) => {
  if (!isServiceCaller(req)) return new Response(null, { status: 403 });
  const t0 = performance.now();
  // 배포 함수 실측용: secret 키 호출이 'test:' 실행 태그를 주면 그 테스트 잡만 가져간다(cron 호출은 본문 없음 → 테스트 잡 제외)
  const body = await req.json().catch(() => ({})) as { lease_prefix?: unknown };
  const prefix = typeof body.lease_prefix === "string" && body.lease_prefix.startsWith("test:") ? body.lease_prefix : null;
  const results: unknown[] = [];
  let claimError: string | null = null;
  const claim = async (): Promise<Job[]> => {
    const { data, error } = await sb.rpc("claim_jobs", { p_limit: 1, p_lease_seconds: LEASE_SECONDS, p_lease_prefix: prefix });
    if (error) { claimError = error.code; return []; }
    return (data ?? []) as Job[];
  };
  const run = async (j: Job) => {
    const tj = performance.now();
    metrics = null;
    const h = handlers[j.kind] ?? (async () => { throw new Error("unknown kind " + j.kind); });
    const outcome = await runJob(j, h, {
      heartbeat: async (id) => {
        const { data, error } = await sb.rpc("heartbeat_job", { p_id: id, p_lease_seconds: LEASE_SECONDS });
        if (error || data !== true) console.log(JSON.stringify({ job_id: id, heartbeat: error ? error.code : "lost" }));
      },
      complete: async (id, cp) => { await sb.rpc("complete_job", { p_id: id, p_checkpoint: cp }); },
      fail: async (id, err) => { await sb.rpc("fail_job", { p_id: id, p_error: err }); },
      defer: async (id, until, code) => { await sb.rpc("defer_job", { p_id: id, p_until: until, p_code: code }); },
    });
    results.push([j.id, outcome, Math.round(performance.now() - tj), metrics]);
  };
  // 비었어도 곧 풀릴 잡(다른 워커가 LLM 슬롯 없음으로 5초 미룬 것)이 있으면 기다렸다 다시 클레임한다
  const claimed = await runBatches(claim, run, { soon: () => nextDeferredWait(sb, prefix, SOON_WINDOW_MS) });
  if (claimError && claimed === 0) return new Response(claimError, { status: 500 });
  const ms = Math.round(performance.now() - t0);
  // 일부 성공 뒤의 클레임 오류도 흔적을 남긴다(코드만)
  console.log(JSON.stringify({ worker: "batch", claimed, ms, ...(claimError ? { claim_error: claimError } : {}) }));
  return Response.json({ claimed, ms, results });
});
