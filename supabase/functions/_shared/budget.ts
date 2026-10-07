// 비용 통제(스펙 §13): 호출 전 금액 예약 → 호출 → 응답마다 원소 기록 → 예약한 달에 정산·집계(한 트랜잭션, 0032 settle_usage_lines).
// 80% 이상이면 level = degraded(채팅 강등), 예약 거부(100%)면 Deferred(다음 달) — 잡은 실패가 아니라 미룬다. 동시 LLM 호출 사용자당 2개(슬롯 없으면 Deferred 5초). 금액은 원
// 슬롯 없음 미루기(0.8.1 수정 1회차, 30초 → 5초): 즉시 호출로 워커가 여럿 떠도 슬롯을 못 잡은 잡이 cron 까지 밀리지 않고,
// 살아 있는 워커 루프(worker/batch.ts soon)가 앞 잡을 끝낸 뒤 다시 가져간다. 채팅은 until 을 쓰지 않는다(자체 3초 재시도 → 503 retry-after 30)
export const LLM_BUSY_DEFER_MS = 5_000;
export type BudgetKind = "extract" | "chat" | "embed" | "backfill";
export type BudgetLevel = "ok" | "degraded";
// 기능별 기록(스펙 §13 "기능별 기록", 0.15.0): 예약 kind = 어느 예산에서 빼는가, 집계 kind = 어느 기능이 썼는가. vision 은 예약 없이 record_usage
export type LedgerKind = "chat" | "mail_summary" | "extract" | "backfill" | "embed" | "vision";
export const LEDGER_PAIRS: Record<BudgetKind, readonly LedgerKind[]> = {
  chat: ["chat", "mail_summary"], extract: ["extract"], backfill: ["backfill"], embed: ["embed"],
};
export type TokenUsage = { input: number; cached: number; output: number };         // cached 는 input 의 일부(따로 더한 값이 아니다)
export type LedgerLine = { kind: LedgerKind; model: string; input: number; cached: number; output: number; krw: number };
// 모델·임베딩 응답을 받은 직후(상태 검사·파싱보다 먼저) 부른다. usage 가 없으면 null — calls 만 센다
export type Bill = (kind: LedgerKind, model: string, usage: TokenUsage | null) => void;
export class Deferred extends Error {
  constructor(readonly until: string, code: string) { super(code); this.name = "Deferred"; }
}
// 1M 토큰당 USD(스펙 §3·§13, 2026-09-26 가격표)
export const PRICE_PER_M: Record<string, { input: number; cached?: number; output: number }> = {
  "gpt-6-luna": { input: 0.10, cached: 0.01, output: 0.50 },
  "gpt-6-sol": { input: 2.00, cached: 0.20, output: 10.00 },
  "text-embedding-3-large": { input: 0.13, output: 0 },
};
export function usdKrw(env: (k: string) => string | undefined = (k) => Deno.env.get(k)): number {
  const n = Number(env("USD_KRW") ?? 1400);
  return Number.isFinite(n) && n > 0 ? n : 1400;
}
export function costKrw(model: string, u: { input: number; output: number; cached?: number }, rate = usdKrw()): number {
  const p = PRICE_PER_M[model];
  if (!p) throw new Error("price_unknown " + model);
  const cached = u.cached ?? 0;
  const usd = ((u.input - cached) * p.input + cached * (p.cached ?? p.input) + u.output * p.output) / 1e6;
  return Math.ceil(usd * rate * 10_000) / 10_000;
}
// Responses API usage → 토큰(스펙 §13 "토큰 출처"). output 은 reasoning 포함(출력 단가로 청구). cached 는 input 을 넘지 않게
export function responseUsage(r: { usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } | null } | null }): TokenUsage | null {
  const u = r.usage;
  if (!u) return null;
  const input = u.input_tokens ?? 0;
  return { input, cached: Math.min(u.input_tokens_details?.cached_tokens ?? 0, input), output: u.output_tokens ?? 0 };
}
// 원소 하나. usage 가 없으면 토큰 0·금액 0(로그 코드 usage_missing — 모델 이름·kind 만)
export function ledgerLine(kind: LedgerKind, model: string, u: TokenUsage | null, rate = usdKrw()): LedgerLine {
  if (!u) {
    console.log(JSON.stringify({ budget: "usage_missing", kind, model }));
    if (!PRICE_PER_M[model]) throw new Error("price_unknown " + model);
    return { kind, model, input: 0, cached: 0, output: 0, krw: 0 };
  }
  return { kind, model, input: u.input, cached: u.cached, output: u.output, krw: costKrw(model, u, rate) };
}
export function nextMonthSeoul(now = new Date()): string {
  const s = new Date(now.getTime() + 9 * 3600_000);
  const y = s.getUTCFullYear(), m = s.getUTCMonth() + 1;
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-01T00:00:00+09:00`;
}
export type Reservation = { level: "ok" | "degraded" | "refused"; month: string };   // month = 예약한 서울 월 1일 'YYYY-MM-01'
export type BudgetDeps = {
  reserve(userId: string, kind: BudgetKind, estKrw: number): Promise<Reservation>;
  settle(userId: string, kind: BudgetKind, estKrw: number, month: string, lines: LedgerLine[]): Promise<void>;
  acquire(userId: string, holder: string): Promise<number | null>;
  release(userId: string, slot: number, holder: string): Promise<void>;
  now(): Date;
};

// 예약 → 슬롯 → call(level, bill) → (성공이든 예외든) 쌓인 원소로 예약한 달에 정산 → 슬롯 반납. 원소가 없으면 예약 취소와 같다(actual 0)
export async function guarded<T>(deps: BudgetDeps, userId: string, kind: BudgetKind, estKrw: number, holder: string,
  call: (level: BudgetLevel, bill: Bill) => Promise<T>): Promise<{ value: T; level: BudgetLevel }> {
  const { level, month } = await deps.reserve(userId, kind, estKrw);
  if (level === "refused") throw new Deferred(nextMonthSeoul(deps.now()), "budget_exhausted");
  const slot = await deps.acquire(userId, holder);
  if (slot === null) {
    await deps.settle(userId, kind, estKrw, month, []);
    throw new Deferred(new Date(deps.now().getTime() + LLM_BUSY_DEFER_MS).toISOString(), "llm_busy");
  }
  const lines: LedgerLine[] = [];
  const bill: Bill = (k, model, u) => {
    if (!LEDGER_PAIRS[kind].includes(k)) throw new Error(`ledger_pair ${kind}>${k}`);   // D10 — 호출부 연결 실수
    lines.push(ledgerLine(k, model, u));
  };
  try {
    return { value: await call(level, bill), level };
  } finally {
    try { await deps.settle(userId, kind, estKrw, month, [...lines]); } finally { await deps.release(userId, slot, holder); }
  }
}
