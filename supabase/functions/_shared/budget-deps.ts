import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { BudgetDeps } from "./budget.ts";

// service role. 모든 RPC 에 user_id 명시(스펙 §12 통제 4)
export function budgetDeps(sb: SupabaseClient): BudgetDeps {
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new Error(fn + " " + error.code);
    return data;
  };
  return {
    reserve: async (u, kind, est) => (await rpc("reserve_usage", { p_user: u, p_kind: kind, p_est_krw: est })) as "ok" | "degraded" | "refused",
    settle: async (u, kind, est, actual) => { await rpc("settle_usage", { p_user: u, p_kind: kind, p_est_krw: est, p_actual_krw: actual }); },
    acquire: async (u, holder) => (await rpc("acquire_llm_slot", { p_user: u, p_holder: holder })) as number | null,
    release: async (u, slot, holder) => { await rpc("release_llm_slot", { p_user: u, p_slot: slot, p_holder: holder }); },
    now: () => new Date(),
  };
}
