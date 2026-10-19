import OpenAI from "npm:openai@7";

// LLM 사용 불가 판별(스펙 §7 jobs 워커 "LLM 사용 불가", 0.16.1): 키 무효·권한·쿼터 소진은 다시 해도 같은 결과라 chat·mail-read 는 즉시 503 llm_unavailable,
// worker 는 30분 미루기(attempts 소비 없음). SDK 클래스 instanceof + status·code 이중 확인 — 일반 429(rate limit)는 해당 없음(기존대로)
export type LlmUnavailableReason = "llm_auth" | "llm_permission" | "llm_quota";
export const LLM_UNAVAILABLE_DEFER_MS = 30 * 60_000;

export function llmUnavailable(e: unknown): LlmUnavailableReason | null {
  if (e instanceof OpenAI.AuthenticationError && e.status === 401) return "llm_auth";
  if (e instanceof OpenAI.PermissionDeniedError && e.status === 403) return "llm_permission";
  if (e instanceof OpenAI.RateLimitError && e.status === 429 && e.code === "insufficient_quota") return "llm_quota";
  return null;
}

export function isOpenAiError(e: unknown): e is InstanceType<typeof OpenAI.APIError> { return e instanceof OpenAI.APIError; }

// 키 모양 문자열 가림(OpenAI 401 메시지에 마스킹된 키 조각이 들어 있다 — 2026-10-19 실측)
export function redactKeys(s: string): string { return s.replace(/sk-[A-Za-z0-9_*.-]+/g, "sk-***"); }

// 로그·jobs.last_error 용 코드: OpenAI 오류는 메시지 없이 상태·코드만, 그 밖은 키 모양을 가린 메시지(각 모듈이 코드·식별자로 만든다) 200자
export function errorCode(e: unknown): string {
  if (isOpenAiError(e)) return e.status ? `openai_${e.status} ${e.code ?? "-"}` : `openai_conn ${e.constructor.name}`;
  return redactKeys(e instanceof Error ? e.message : "error").slice(0, 200);
}
