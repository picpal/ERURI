import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { BudgetDeps, LedgerLine, Reservation } from "./budget.ts";

// service role. 모든 RPC 에 user_id 명시(스펙 §12 통제 4). 0032: 예약은 달을 함께 돌려받고, 정산은 그 달에 원소와 함께(§13 "월 경계")
export function budgetDeps(sb: SupabaseClient): BudgetDeps {
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new Error(fn + " " + error.code);
    return data;
  };
  return {
    reserve: async (u, kind, est) => {
      const r = ((await rpc("reserve_usage_month", { p_user: u, p_kind: kind, p_est_krw: est })) as { status: Reservation["level"]; month: string }[] | null)?.[0];
      if (!r) throw new Error("reserve_usage_month empty");
      return { level: r.status, month: r.month };
    },
    settle: async (u, kind, est, month, lines) => {
      await rpc("settle_usage_lines", { p_user: u, p_kind: kind, p_est_krw: est, p_month: month, p_lines: lines });
    },
    acquire: async (u, holder) => (await rpc("acquire_llm_slot", { p_user: u, p_holder: holder })) as number | null,
    release: async (u, slot, holder) => { await rpc("release_llm_slot", { p_user: u, p_slot: slot, p_holder: holder }); },
    now: () => new Date(),
  };
}

// vision(이미지·PDF 추출) 기록만(스펙 §13 — 예약 없음, record_usage). 실패는 호출부가 로그 코드로만 남긴다(L3)
export async function recordUsage(sb: SupabaseClient, userId: string, lines: LedgerLine[]): Promise<void> {
  const { error } = await sb.rpc("record_usage", { p_user: userId, p_lines: lines });
  if (error) throw new Error("record_usage " + error.code);
}
