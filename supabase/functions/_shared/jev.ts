import { type Classifier, CLASSIFY_INSTRUCTIONS, CLASSIFY_TIMEOUT_MS, type ClassifyMeta, type ClassifyResult, isClassifyResult, LABEL_CRITERIA,
  raceTimeout } from "./classify.ts";

// TypeSafe Jev 분류 어댑터 — 게이트 채택안(2026-09-29 사용자 결정, docs/superpowers/reports/2026-09-29-jev-classification-eval.html).
// 계약(리포트 부록, 실호출 확인): POST /v1/systemone, Bearer, 본문 {state, model, questions}. Choice 답 {type, choice, confidence, probabilities}.
// 오류 401·422·429·529. 429·529 만 짧게 재시도하고 나머지는 오류 → 게이트가 추출로 넘긴다(fail-open). 로그에 본문·키 금지
export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const JEV_MODEL = "jev-1.13.0";            // 버전 고정: 버전이 바뀌면 confidence 분포도 바뀐다(리포트 ③, 문서 권고)
export const JEV_RETRY_MS = [300, 600];           // 429·529 재시도 간격. 전체는 CLASSIFY_TIMEOUT_MS 안에서 끝난다
export const JEV_BODY_MAX = 2000;

// criteria 는 평가 스크립트의 대조군(bare)만 바꾼다. 운영은 LABEL_CRITERIA
export function buildJevRequest(text: string, meta: ClassifyMeta, criteria: Record<string, unknown> = LABEL_CRITERIA) {
  return {
    state: { app: meta.appName ?? meta.source, title: meta.title, sender: null, body: text.slice(0, JEV_BODY_MAX) },   // 발신자는 보내지 않는다
    model: JEV_MODEL,
    questions: { kind: { type: "choice" as const, instructions: CLASSIFY_INSTRUCTIONS, criteria } },
  };
}

export function parseJevResponse(json: unknown): ClassifyResult | null {
  const a = (json as { answers?: { kind?: { type?: unknown; choice?: unknown; confidence?: unknown } } } | null)?.answers?.kind;
  if (!a || a.type !== "choice") return null;
  const r = { label: a.choice, confidence: a.confidence };
  return isClassifyResult(r) ? r : null;
}

export type JevTransport = (body: unknown, signal: AbortSignal) => Promise<{ status: number; json: unknown }>;

export function jevHttpTransport(o: { apiKey: string; fetchFn?: typeof fetch }): JevTransport {
  return async (body, signal) => {
    const r = await (o.fetchFn ?? fetch)(JEV_ENDPOINT, { method: "POST", signal,
      headers: { authorization: `Bearer ${o.apiKey}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
}

export function jevClassifier(o: { transport: JevTransport; timeoutMs?: number; sleep?: (ms: number) => Promise<void> }): Classifier {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  return {
    provider: "jev",
    async classify(text, meta) {
      let r: { status: number; json: unknown };
      try {
        r = await raceTimeout(async (signal) => {
          for (let i = 0; ; i++) {
            const res = await o.transport(buildJevRequest(text, meta), signal);
            if ((res.status === 429 || res.status === 529) && i < JEV_RETRY_MS.length) { await sleep(JEV_RETRY_MS[i]); continue; }
            return res;
          }
        }, o.timeoutMs ?? CLASSIFY_TIMEOUT_MS, "classify jev_timeout");
      } catch (e) {
        throw e instanceof Error && e.message === "classify jev_timeout" ? e : new Error("classify jev_network");
      }
      if (r.status !== 200) throw new Error(`classify jev_status_${r.status}`);
      const parsed = parseJevResponse(r.json);
      if (!parsed) throw new Error("classify jev_bad_response");
      return parsed;
    },
  };
}
