// 비용 통제(스펙 §13): 호출 전 금액 예약 → 호출 → 실제 토큰으로 정산. 80% 이상이면 level = degraded(채팅 강등),
// 예약 거부(100%)면 Deferred(다음 달) — 잡은 실패가 아니라 미룬다. 동시 LLM 호출 사용자당 2개(슬롯 없으면 Deferred 5초). 금액은 원
// 슬롯 없음 미루기(0.8.1 수정 1회차, 30초 → 5초): 즉시 호출로 워커가 여럿 떠도 슬롯을 못 잡은 잡이 cron 까지 밀리지 않고,
// 살아 있는 워커 루프(worker/batch.ts soon)가 앞 잡을 끝낸 뒤 다시 가져간다. 채팅은 until 을 쓰지 않는다(자체 3초 재시도 → 503 retry-after 30)
export const LLM_BUSY_DEFER_MS = 5_000;
export type BudgetKind = "extract" | "chat" | "embed" | "backfill";
export type BudgetLevel = "ok" | "degraded";
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
export function nextMonthSeoul(now = new Date()): string {
  const s = new Date(now.getTime() + 9 * 3600_000);
  const y = s.getUTCFullYear(), m = s.getUTCMonth() + 1;
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-01T00:00:00+09:00`;
}
export type BudgetDeps = {
  reserve(userId: string, kind: BudgetKind, estKrw: number): Promise<"ok" | "degraded" | "refused">;
  settle(userId: string, kind: BudgetKind, estKrw: number, actualKrw: number): Promise<void>;
  acquire(userId: string, holder: string): Promise<number | null>;
  release(userId: string, slot: number, holder: string): Promise<void>;
  now(): Date;
};

export async function guarded<T>(deps: BudgetDeps, userId: string, kind: BudgetKind, estKrw: number, holder: string,
  call: (level: BudgetLevel) => Promise<{ value: T; actualKrw: number }>): Promise<{ value: T; level: BudgetLevel }> {
  const level = await deps.reserve(userId, kind, estKrw);
  if (level === "refused") throw new Deferred(nextMonthSeoul(deps.now()), "budget_exhausted");
  const slot = await deps.acquire(userId, holder);
  if (slot === null) {
    await deps.settle(userId, kind, estKrw, 0);
    throw new Deferred(new Date(deps.now().getTime() + LLM_BUSY_DEFER_MS).toISOString(), "llm_busy");
  }
  let actual = 0;
  try {
    const r = await call(level);
    actual = r.actualKrw;
    return { value: r.value, level };
  } finally {
    try { await deps.settle(userId, kind, estKrw, actual); } finally { await deps.release(userId, slot, holder); }
  }
}
