import { assert, assertEquals } from "jsr:@std/assert";
import { type AggCase, type AggCaseFile, type AggRow, BOUNDARY_TEXTS, DAY_GROUP, judgeAgg, parseEvalMode, summarizeAgg, validateAggCases } from "../scripts/_agg-eval.ts";
import { errorRates, excludeIdentical, flakyCases, newlyWrong, newlyWrongByRate, type Row, unsettled } from "../scripts/_intent-eval.ts";
import type { Intent } from "../functions/chat/filters.ts";

const file = JSON.parse(await Deno.readTextFile(new URL("../eval/agg-cases.json", import.meta.url))) as AggCaseFile;
const byId = (id: string) => file.cases.find((c) => c.id === id)!;
// 기대값과 같은 모델 출력(집계 칸은 기대 6칸 그대로, 저장 규칙은 기대 종류·값)
const echo = (c: AggCase) => ({ intent: c.intent, aggregate: c.agg ? { ...c.agg } : null, save_rule: c.rule ? { ...c.rule } : null });

Deno.test("validateAggCases: the committed file passes; removing one case or one boundary text fails", () => {
  assertEquals(file.today, "2026-10-21");
  assertEquals([file.cases.length, file.cases.filter((c) => c.group === DAY_GROUP).length], [46, 2]);   // 44 + 보충 agg_day 2(0.18.1)
  assertEquals(validateAggCases(file), []);
  assertEquals(BOUNDARY_TEXTS.length, 20);
  const dropped = validateAggCases({ ...file, cases: file.cases.filter((c) => c.id !== "g07") });
  assert(dropped.some((p) => p.startsWith("cases 43")), JSON.stringify(dropped));
  // 경계 예시 하나의 글을 바꾸면(구성은 그대로) 그 문장이 없다고 보고
  const b = file.cases.find((c) => c.text === BOUNDARY_TEXTS[0])!;
  const renamed = validateAggCases({ ...file, cases: file.cases.map((c) => c.id === b.id ? { ...c, text: `${c.text} ` } : c) });
  assertEquals(renamed, [`boundary missing: ${BOUNDARY_TEXTS[0]}`]);
  // 구성: 단발 aggregate 의 bucket 하나를 바꾸면 hour/day 수가 어긋난다, 연속 턴 previous 를 빼면 그 사례가 실패
  const hourToDay = validateAggCases({ ...file, cases: file.cases.map((c) => c.group === "agg" && c.agg?.bucket === "hour" && c.id === byId("g01").id
    ? { ...c, agg: { ...c.agg!, bucket: "day" as const } } : c) });
  assert(hourToDay.some((p) => p.startsWith("bucket hour")), JSON.stringify(hourToDay));
  const noPrev = validateAggCases({ ...file, cases: file.cases.map((c) => c.group === "seq_a" ? { ...c, previous: undefined } : c) });
  assert(noPrev.some((p) => p.includes("seq_a") || p.includes(file.cases.find((x) => x.group === "seq_a")!.id)), JSON.stringify(noPrev));
});

Deno.test("judgeAgg: revalidates the model's aggregate (and previous) before comparing; keywords compare as case-insensitive sets", () => {
  const g01 = byId("g01");   // 이번 주 합성PAY 타임아웃 언제 많았어? → 10/19~10/21(서버가 미래 to 를 오늘로), hour
  const ok = judgeAgg(g01, { intent: "aggregate", save_rule: null,
    aggregate: { keywords: ["타임아웃", "합성pay"], sender: null, sources: [], from: "2026-10-19", to: "2026-10-25", bucket: "hour" } });
  assertEquals([ok.got, ok.status, ok.keywords_ok, ok.from_ok, ok.to_ok, ok.bucket_ok, ok.sources_ok, ok.sender_ok], ["aggregate", "ok", true, true, true, true, true, true]);
  // bucket null → 서버 day(개수만 묻는 g04)
  const g04 = byId("g04");
  const cnt = judgeAgg(g04, { intent: "aggregate", save_rule: null, aggregate: { ...g04.agg!, bucket: null } });
  assertEquals(cnt.bucket_ok, true);
  // 키워드 0개 + 직전 조건 없음 → 서버가 질문 흐름(실제 의도 question, 모델 의도는 aggregate 로 남긴다)
  const q = byId("q01");
  const fallback = judgeAgg(q, { intent: "aggregate", save_rule: null, aggregate: { keywords: [], sender: null, sources: ["MESSAGES"], from: null, to: null, bucket: null } });
  assertEquals([fallback.got, fallback.model, fallback.expected], ["question", "aggregate", "question"]);
  // 무효 조건(1자 키워드) → bad_condition, 의도는 aggregate 이지만 칸은 모두 틀림
  const bad = judgeAgg(g01, { intent: "aggregate", save_rule: null, aggregate: { ...g01.agg!, keywords: ["합성PAY", "A"] } });
  assertEquals([bad.got, bad.status, bad.keywords_ok, bad.bucket_ok], ["aggregate", "bad_condition", false, false]);
  // 연속 턴: 지금 글은 day 만 → previous 로 키워드·기간 이어받음
  const sa = file.cases.find((c) => c.group === "seq_a")!;
  const inh = judgeAgg(sa, { intent: "aggregate", save_rule: null, aggregate: { keywords: [], sender: null, sources: [], from: null, to: null, bucket: "day" } });
  assertEquals([inh.keywords_ok, inh.from_ok, inh.to_ok, inh.bucket_ok, inh.sources_ok], [true, true, true, true, true]);
  // 출처 구별: 문자만인데 알림까지 붙이면 sources 틀림
  const sms = file.cases.find((c) => !c.previous && c.agg?.sources.length === 1 && c.agg.sources[0] === "MESSAGES")!;
  const over = judgeAgg(sms, { intent: "aggregate", save_rule: null, aggregate: { ...sms.agg!, sources: ["MESSAGES", "NOTIFICATION"] } });
  assertEquals([over.split, over.sources_ok], [true, false]);
  // 의도 놓침: 집계 칸 전부 false, 다른 의도 행은 칸 null
  const miss = judgeAgg(g01, { intent: "question", aggregate: null, save_rule: null });
  assertEquals([miss.got, miss.keywords_ok, miss.bucket_ok], ["question", false, false]);
  assertEquals(judgeAgg(q, echo(q)).keywords_ok, null);
  // 저장 규칙: 값 대소문자·안쪽 공백 정규화 뒤 비교, 종류도 맞아야
  const r = file.cases.find((c) => c.intent === "save_rule_add" && c.rule!.kind === "keyword")!;
  assertEquals(judgeAgg(r, { intent: "save_rule_add", aggregate: null, save_rule: { kind: "keyword", value: ` ${r.rule!.value.toLowerCase()} ` } }).rule_ok, true);
  assertEquals(judgeAgg(r, { intent: "save_rule_add", aggregate: null, save_rule: { kind: "sender", value: r.rule!.value } }).rule_ok, false);
  assertEquals(judgeAgg(r, { intent: "save_rule_remove", aggregate: null, save_rule: { ...r.rule! } }).rule_ok, false);
  // 기대값을 그대로 낸 출력은 46개 모두 맞음
  for (const c of file.cases) {
    const row = judgeAgg(c, echo(c));
    assert(row.got === c.intent && row.keywords_ok !== false && row.bucket_ok !== false && row.sources_ok !== false && row.from_ok !== false &&
      row.to_ok !== false && row.sender_ok !== false && row.rule_ok !== false, c.id);
  }
});

Deno.test("agg_day supplement (0.18.1): the model's empty or last-7-days period on '오늘'·'어제' is pinned by the server; validator and ⑩ day 2/2 outside the 44", () => {
  const days = file.cases.filter((c) => c.group === DAY_GROUP);
  assertEquals(days.map((c) => [c.id, c.agg!.from, c.agg!.to]), [["y01", "2026-10-21", "2026-10-21"], ["y02", "2026-10-20", "2026-10-20"]]);
  for (const c of days) {
    for (const [from, to] of [[null, null], ["2026-10-15", "2026-10-21"]]) {
      const row = judgeAgg(c, { intent: "aggregate", aggregate: { ...c.agg!, from, to }, save_rule: null }, file.today);
      assertEquals([row.from_ok, row.to_ok], [true, true], `${c.id} ${from}`);
    }
  }
  // 하루 말을 지운 글은 고정되지 않아 검사가 막는다
  const bad = validateAggCases({ ...file, cases: file.cases.map((c) => c.id === "y01" ? { ...c, text: "합성PAY 타임아웃 몇 건이야?" } : c) });
  assert(bad.some((p) => p.includes("y01 agg_day")), JSON.stringify(bad));
  assert(validateAggCases({ ...file, cases: file.cases.filter((c) => c.id !== "y02") }).some((p) => p.includes(`${DAY_GROUP} 1 != 2`)));
  // 보충이 의도를 놓치면 실패, 44 합격선 숫자에는 들지 않는다
  const perfect = file.cases.map((c) => judgeAgg(c, echo(c)));
  const missed = perfect.map((r) => r.id === "y01" ? { ...r, got: "question" as Intent, from_ok: false, to_ok: false } : r);
  const m = summarizeAgg([missed]);
  assertEquals([m.pass, m.per_run[0].intent, m.per_run[0].day, m.per_run[0].wrong], [false, 44, 1, ["y01"]]);
});

Deno.test("summarizeAgg: thresholds per run; one run under → pass false", () => {
  const perfect = file.cases.map((c) => judgeAgg(c, echo(c)));
  const s = summarizeAgg([perfect, perfect]);
  assertEquals(s.pass, true);
  assertEquals([s.per_run[0].cases, s.per_run[0].intent, s.per_run[0].aggregate_cases, s.per_run[0].split_cases, s.per_run[0].rule_cases, s.per_run[0].day_cases,
    s.per_run[0].day], [44, 44, 16, 7, 10, 2, 2]);
  const set = (rows: AggRow[], id: string, o: Partial<AggRow>) => rows.map((r) => r.id === id ? { ...r, ...o } : r);
  const aggIds = perfect.filter((r) => r.expected === "aggregate").map((r) => r.id);
  // 의도 2개 틀림까지는 통과(42/44), 3개면 실패
  const two = set(set(perfect, "g01", { got: "question" }), "r01", { got: "question" });
  assertEquals(summarizeAgg([two]).per_run[0].intent, 42);
  // 다른 의도 하나가 aggregate 로 가면 실패(의도 43/44 라도)
  assertEquals(summarizeAgg([perfect, set(perfect, "q01", { got: "aggregate" })]).pass, false);
  // add ↔ remove 혼동 하나면 실패
  assertEquals(summarizeAgg([set(perfect, "r01", { got: "save_rule_remove", rule_ok: false })]).pass, false);
  // bucket 15/16 통과, 14/16 실패
  assertEquals(summarizeAgg([set(perfect, aggIds[0], { bucket_ok: false })]).pass, true);
  assertEquals(summarizeAgg([set(set(perfect, aggIds[0], { bucket_ok: false }), aggIds[1], { bucket_ok: false })]).pass, false);
  // 키워드 14/16 통과, 13/16 실패
  const kw = (n: number) => aggIds.slice(0, n).reduce((rows, id) => set(rows, id, { keywords_ok: false }), perfect);
  assertEquals([summarizeAgg([kw(2)]).pass, summarizeAgg([kw(3)]).pass], [true, false]);
  // 출처 구별 7사례 중 하나라도 틀리면 실패(sources 전체로는 15/16 이어도)
  const splitId = perfect.find((r) => r.split)!.id;
  assertEquals(summarizeAgg([set(perfect, splitId, { sources_ok: false })]).pass, false);
  // 의도를 놓친 출처 사례(→ question)는 의도 일치에서 센다 — 출처 구별 분모는 aggregate 로 간 사례만(2026-10-21 메인 판정, Ruling A10-src)
  const missed = summarizeAgg([set(perfect, splitId, { got: "question", keywords_ok: false, sender_ok: false, sources_ok: false, from_ok: false, to_ok: false,
    bucket_ok: false })]).per_run[0];
  assertEquals([missed.intent, missed.split_cases, missed.split, missed.pass], [43, 6, 6, true]);
  // 저장 규칙 9/10 통과, 8/10 실패
  const ruleIds = perfect.filter((r) => r.rule_ok !== null).map((r) => r.id);
  assertEquals(summarizeAgg([set(perfect, ruleIds[0], { rule_ok: false })]).pass, true);
  assertEquals(summarizeAgg([set(set(perfect, ruleIds[0], { rule_ok: false }), ruleIds[1], { rule_ok: false })]).pass, false);
  // 한 회차만 미달이면 전체 실패, 실행이 없으면 실패
  assertEquals(summarizeAgg([perfect, kw(3)]).pass, false);
  assertEquals(summarizeAgg([]).pass, false);
});

Deno.test("newlyWrong: right in both baseline runs and wrong in any 0.17 run → listed; flaky baseline not listed", () => {
  const row = (id: string, expected: Intent, got: Intent, o: Partial<Row> = {}): Row => ({ id, group: "g", expected, got, mail_ok: null, read_ok: null, target_ok: null, ...o });
  const base = [row("a", "question", "question"), row("b", "add_event", "add_event"), row("c", "question", "add_event"), row("m", "mail_action", "mail_action", { mail_ok: true }),
    row("a", "question", "question"), row("b", "add_event", "add_event"), row("c", "question", "question"), row("m", "mail_action", "mail_action", { mail_ok: true })];
  const agg = [row("a", "question", "question"), row("b", "add_event", "add_event"), row("c", "question", "aggregate"), row("m", "mail_action", "mail_action", { mail_ok: true }),
    row("a", "question", "save_rule_list"), row("b", "add_event", "add_event"), row("c", "question", "question"), row("m", "mail_action", "mail_action", { mail_ok: false })];
  assertEquals(newlyWrong(base, agg), ["a", "m"]);   // c 는 기준선 1회 틀림(흔들림) — 제외. m 은 칸 불일치도 틀림
  assertEquals(newlyWrong(base, base), []);
  assertEquals(newlyWrong(base.filter((r) => r.id !== "b"), agg), ["a", "m"]);   // 기준선에 없는 id 는 새로 틀린 것으로 보지 않는다
  assertEquals(newlyWrong(base, agg.filter((r) => r.id !== "b")), ["a", "b", "m"]);   // 0.17 행이 빠진 id 는 틀림(빈 every 방지)
});

Deno.test("parseEvalMode: default 0.16, --mode both / 0.17 / 0.16, anything else null", () => {
  assertEquals(parseEvalMode([]), "0.16");
  assertEquals(parseEvalMode(["--runs", "2", "--mode", "both"]), "both");
  assertEquals(parseEvalMode(["--mode", "0.17"]), "0.17");
  assertEquals(parseEvalMode(["--mode", "0.16"]), "0.16");
  assertEquals(parseEvalMode(["--mode"]), null);
  assertEquals(parseEvalMode(["--mode", "all"]), null);
});

Deno.test("flakyCases: baseline split across runs (some right, some wrong) → listed with right/total ratios for both modes; steady cases not listed", () => {
  const row = (id: string, got: Intent, o: Partial<Row> = {}): Row => ({ id, group: "g", expected: "question", got, mail_ok: null, read_ok: null, target_ok: null, ...o });
  const base = [row("a", "question"), row("a", "add_event"), row("a", "question"), row("a", "question"), row("b", "question"), row("b", "question"),
    row("b", "question"), row("b", "question"), row("c", "add_event"), row("c", "add_event"), row("c", "add_event"), row("c", "add_event")];
  const agg = [row("a", "question"), row("a", "question"), row("a", "question"), row("a", "question"), row("b", "question"), row("b", "aggregate"),
    row("b", "question"), row("b", "question"), row("c", "add_event"), row("c", "question"), row("c", "add_event"), row("c", "add_event")];
  assertEquals(flakyCases(base, agg), [{ id: "a", base_right: 3, base_runs: 4, agg_right: 4, agg_runs: 4 }]);   // c 는 늘 틀림(흔들림 아님), b 는 기준선 4/4
  assertEquals(newlyWrong(base, agg), ["b"]);   // 흔들림 a·늘 틀림 c 는 비교에서 빠진다
});

Deno.test("rate judgment: cases split in either mode get extra runs; new_wrong = 0.17 wrong rate − baseline wrong rate ≥ 25%p over all runs", () => {
  const row = (id: string, got: Intent): Row => ({ id, group: "g", expected: "question", got, mail_ok: null, read_ok: null, target_ok: null });
  const rows = (id: string, wrong: number, n: number) => Array.from({ length: n }, (_, i) => row(id, i < wrong ? "add_event" : "question"));
  // 4회: a 는 두 모드 다 늘 맞음(추가 실행 없음), b 는 0.17 에서 1/4 틀림, c 는 기준선 1/4 틀림, d 는 두 모드 다 늘 틀림
  const base4 = [...rows("a", 0, 4), ...rows("b", 0, 4), ...rows("c", 1, 4), ...rows("d", 4, 4)];
  const agg4 = [...rows("a", 0, 4), ...rows("b", 1, 4), ...rows("c", 0, 4), ...rows("d", 4, 4)];
  assertEquals(unsettled(base4, agg4), ["b", "c", "d"]);
  // 추가 8회 뒤(합 12회): b 0.17 4/12 − 기준선 0/12 = 33%p → 새로 틀림. c 0.17 2/12 − 기준선 3/12 < 0. d 12/12 − 12/12 = 0
  const base = [...base4, ...rows("b", 0, 8), ...rows("c", 2, 8), ...rows("d", 8, 8)];
  const agg = [...agg4, ...rows("b", 3, 8), ...rows("c", 2, 8), ...rows("d", 8, 8)];
  const r = errorRates(base, agg, ["b", "c", "d"]);
  assertEquals(r.map((x) => [x.id, x.base_wrong, x.base_runs, x.agg_wrong, x.agg_runs]), [["b", 0, 12, 4, 12], ["c", 3, 12, 2, 12], ["d", 12, 12, 12, 12]]);
  assertEquals(newlyWrongByRate(r), ["b"]);
  // 경계: 정확히 25%p 는 새로 틀림(3/12 − 0/12), 그 아래는 아님(2/12 − 0/12)
  assertEquals(newlyWrongByRate([{ id: "x", base_wrong: 0, base_runs: 12, agg_wrong: 3, agg_runs: 12, diff: 0.25 }, { id: "y", base_wrong: 0, base_runs: 12, agg_wrong: 2,
    agg_runs: 12, diff: 2 / 12 }]), ["x"]);
});

Deno.test("excludeIdentical (Ruling A10-identical): ids whose two-mode requests are byte-identical leave the regression comparison", () => {
  assertEquals(excludeIdentical(["q02", "s04", "s28"], ["s04", "s28", "a01"]), ["q02"]);
  assertEquals(excludeIdentical(["s28"], []), ["s28"]);
});
