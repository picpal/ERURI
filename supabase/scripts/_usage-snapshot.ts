// 스모크용 ledger 스냅샷·되돌리기(계획 D17): 테스트 사용자 한 명·이번 서울 월만. 되돌리기는 이번 실행의 증가분만 — 앞선 실행·다른 게이트의 집계는 남는다.
// 출력·기록은 kind·model·숫자만
import { service as sb } from "../tests/_testenv.ts";

export type UsageRow = { kind: string; model: string; calls: number; input_tokens: number; cached_tokens: number; output_tokens: number; krw: number };
export type UsageSnap = { month: string; reserved: number; rows: UsageRow[] };
const key = (r: { kind: string; model: string }) => `${r.kind}|${r.model}`;
const num = (r: Record<string, unknown>): UsageRow => ({ kind: String(r.kind), model: String(r.model), calls: Number(r.calls), input_tokens: Number(r.input_tokens),
  cached_tokens: Number(r.cached_tokens), output_tokens: Number(r.output_tokens), krw: Number(r.krw) });

export async function snapshotUsage(user: string): Promise<UsageSnap> {
  const { data: month, error: me } = await sb.rpc("seoul_month");
  if (me) throw new Error("seoul_month " + me.code);
  const c = await sb.from("usage_counters").select("reserved_krw").eq("user_id", user).eq("month", month).maybeSingle();
  if (c.error) throw new Error("usage_counters " + c.error.code);
  const l = await sb.from("usage_ledger").select("kind, model, calls, input_tokens, cached_tokens, output_tokens, krw").eq("user_id", user).eq("month", month);
  if (l.error) throw new Error("usage_ledger " + l.error.code);
  return { month: month as string, reserved: Number(c.data?.reserved_krw ?? 0), rows: (l.data ?? []).map(num) };
}
// b − a, (kind, model) 마다(바뀐 행만)
export function diffUsage(a: UsageSnap, b: UsageSnap): UsageRow[] {
  const base = new Map(a.rows.map((r) => [key(r), r]));
  return b.rows.map((r) => {
    const o = base.get(key(r));
    return { kind: r.kind, model: r.model, calls: r.calls - (o?.calls ?? 0), input_tokens: r.input_tokens - (o?.input_tokens ?? 0),
      cached_tokens: r.cached_tokens - (o?.cached_tokens ?? 0), output_tokens: r.output_tokens - (o?.output_tokens ?? 0), krw: r.krw - (o?.krw ?? 0) };
  }).filter((d) => d.calls !== 0 || d.krw !== 0);
}
// 지금 − (지금 − S0): S0 에 없던 행은 그 행만 지우고, 있던 행은 S0 값으로, reserved_krw 도 S0 로. 서울 월이 바뀌었으면 멈춘다(자정 ±10분 밖에서 돌린다)
export async function restoreUsage(user: string, s0: UsageSnap): Promise<void> {
  const now = await snapshotUsage(user);
  if (now.month !== s0.month) throw new Error("month_changed");
  const base = new Map(s0.rows.map((r) => [key(r), r]));
  for (const r of now.rows) {
    const o = base.get(key(r));
    const q = sb.from("usage_ledger");
    const res = o
      ? await q.update({ calls: o.calls, input_tokens: o.input_tokens, cached_tokens: o.cached_tokens, output_tokens: o.output_tokens, krw: o.krw })
          .eq("user_id", user).eq("month", now.month).eq("kind", r.kind).eq("model", r.model)
      : await q.delete().eq("user_id", user).eq("month", now.month).eq("kind", r.kind).eq("model", r.model);
    if (res.error) throw new Error("usage_ledger restore " + res.error.code);
  }
  const u = await sb.from("usage_counters").update({ reserved_krw: s0.reserved }).eq("user_id", user).eq("month", now.month);
  if (u.error) throw new Error("usage_counters restore " + u.error.code);
}
