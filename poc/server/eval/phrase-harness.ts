import type { Classifier } from "../supabase/functions/_shared/classify.ts";
import { processText, type TextDeps } from "../supabase/functions/worker/text.ts";

// DB 없이 processText 를 돌린다: 항목·저장·상태는 메모리, 분류기·추출은 호출 쪽이 준다(테스트는 가짜, 평가는 실제)
export async function runPhrase(p: { id: string; text: string }, o: { classifier: Classifier; threshold: number; extract: TextDeps["extract"]; today: string }):
  Promise<{ status: string; kind: string | null; tokens: number }> {
  const occurredAt = `${o.today}T01:00:00Z`;          // 서울 10:00 — 받은 날 = today
  let status = "queued", kind: string | null = null, tokens = 0;
  const deps: TextDeps = {
    getItem: async () => ({ contentEnc: "mem", source: "NOTIFICATION", appName: "Slack", sender: null, title: null,
      occurredAt, capturedAt: occurredAt, status }),
    decrypt: async () => p.text,
    classifier: o.classifier,
    threshold: o.threshold,
    extract: o.extract,
    addTokens: async (_u, n) => { tokens += n; },
    saveFact: async (f) => { kind = f.kind; status = "extracted"; return { factId: "mem-fact", proposalId: f.kind === "purchase" ? null : "mem-proposal", created: true }; },
    setStatus: async (_u, _i, s) => { status = s; },
    enqueueNotify: async () => {},
    unpushedProposals: async () => [],
  };
  await processText(deps, { id: `eval-${p.id}`, kind: "process", user_id: "eval", payload: { item_id: p.id }, attempts: 1, checkpoint: null });
  return { status, kind, tokens };
}
