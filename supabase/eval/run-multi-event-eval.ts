// 다건 일정 추출 평가(스펙 §7 2026-10-01): 실제 gpt-6-luna 추출만(DB·분류기 없음), 문구는 합성(multi-event.json).
// 사용: deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/eval/run-multi-event-eval.ts [--runs 3]
// 판정(사례·회차마다): kind 일치 · event 면 개수 = 기대 개수, 기대 시작이 순서대로 맞음(날짜만 기대는 완전 일치, 시각 기대는 접두), ends 도 같은 규칙.
// 원인 코드: kind(종류 틀림) · split(기대보다 많음 = 오분할) · missing(적거나 기대 시작이 없음) · time(날짜만 기대인데 시각이 붙음 — 서버가 ADD_EVENT 로 보낸다)
// · end · error(추출 throw — 출력 잘림 등, 사례별 집계). 출력은 id·개수·코드·토큰만
import { extractTextDetailed, type TextMeta } from "../functions/_shared/extract-text.ts";

type Case = { id: string; kind: string; text: string; starts: string[]; ends?: string[]; today?: string; meta?: TextMeta };
const spec = JSON.parse(await Deno.readTextFile(new URL("./multi-event.json", import.meta.url))) as { today: string; cases: Case[] };
const arg = (k: string) => { const i = Deno.args.indexOf(k); return i >= 0 ? Deno.args[i + 1] : undefined; };
const runs = Math.max(1, Number(arg("--runs") ?? 3));
const META: TextMeta = { source: "MESSAGES", appName: null, title: null };   // 문자 = 메시지 트리거(F15)
const OUT_GATE = 1230;                                                       // 상한 2,048 의 60%
const tally = { ok: 0, kind: 0, split: 0, missing: 0, time: 0, end: 0, error: 0 };
let maxOut = 0, sumOut = 0, nOut = 0;

// 날짜만 기대(T 없음)는 완전 일치 — 접두면 "2026-10-23T09:00…" 같은 시각 환각이 통과한다
const same = (w: string, g: string | null | undefined): "ok" | "time" | "miss" =>
  w.includes("T") ? ((g ?? "").startsWith(w) ? "ok" : "miss") : g === w ? "ok" : (g ?? "").startsWith(`${w}T`) ? "time" : "miss";

export function judge(c: Case, got: { kind: string; starts: string[]; ends: (string | null)[] }): Exclude<keyof typeof tally, "error"> {
  if (got.kind !== c.kind) return "kind";
  if (c.kind !== "event") return "ok";
  if (got.starts.length > c.starts.length) return "split";
  if (got.starts.length < c.starts.length) return "missing";
  const s = c.starts.map((w, i) => same(w, got.starts[i]));
  if (s.includes("miss")) return "missing";
  if (s.includes("time")) return "time";
  if (c.ends?.some((w, i) => same(w, got.ends[i]) !== "ok")) return "end";
  return "ok";
}

if (import.meta.main) {
  for (let r = 1; r <= runs; r++) {
    for (const c of spec.cases) {
      try {
        const { result, usage } = await extractTextDetailed(c.text, c.meta ?? META, c.today ?? spec.today);
        const events = result.kind === "event" ? result.events : [];
        const v = judge(c, { kind: result.kind, starts: events.map((e) => e.event.start ?? ""), ends: events.map((e) => e.event.end) });
        tally[v]++;
        maxOut = Math.max(maxOut, usage.output_tokens); sumOut += usage.output_tokens; nOut++;
        console.log([r, c.id, c.kind, c.starts.length, result.kind, events.length, v, usage.output_tokens].join("\t"));
      } catch (e) {                                                            // 메시지 원문은 찍지 않는다(코드만)
        tally.error++;
        console.log([r, c.id, c.kind, c.starts.length, "-", 0, "error", /incomplete|max_output/i.test(String((e as Error).message)) ? "incomplete" : "throw"].join("\t"));
      }
    }
  }
  console.log(JSON.stringify({ runs, cases: spec.cases.length, ...tally, max_output_tokens: maxOut, mean_output_tokens: nOut ? Math.round(sumOut / nOut) : 0 }));
  Deno.exit(tally.ok === runs * spec.cases.length && maxOut < OUT_GATE ? 0 : 1);
}
