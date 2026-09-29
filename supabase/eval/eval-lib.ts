// 스펙 §9 실데이터 검색 평가: 질문 파일 검증·채점·집계(본문 없음). 러너(eval-search.ts)와 테스트가 같이 쓴다
// 태그(선택)는 ⑩b 에서 따로 셀 유형(원장 M2-⑧b): deep_chunk = 긴 메일에서 답이 첫 청크 밖, period_kind = "지난주 받은 일정 메일" 같은
// 받은기간+종류 복합, period_no_answer = 받은기간을 건 무근거 질문(기간 0건 → 기간 없이 재검색하는 폴백이 거절을 약화시키는지)
export const TAGS = { deep_chunk: "answer", period_kind: "answer", period_no_answer: "no_answer" } as const;
export type Tag = keyof typeof TAGS;
export type Question = {
  id: string; question: string; kind: "answer" | "no_answer"; expected_item_ids: string[];
  date_filter?: boolean; title_only_answerable?: boolean; source?: "GMAIL" | "NOTIFICATION" | "SHARE"; tags?: Tag[];
};
export type ChatResponse = { hits: string[]; refused: boolean; source_item_ids: string[]; ms: number };
export type Score = { id: string; top5: boolean; refused: boolean; refusal_ok: boolean; cited_expected: boolean; date_filter_miss: boolean; ms: number };
export type TagSummary = { n: number; top5: number; refusal_ok: number };
export type Summary = { answer_n: number; no_answer_n: number; top5_rate: number; refusal_rate: number; cited_expected_rate: number;
  date_filter_misses: number; p95_ms: number; pass: boolean; by_tag: Record<string, TagSummary> };

export function validateQuestions(qs: Question[]): string[] {
  const v: string[] = [];
  const answer = qs.filter((q) => q.kind === "answer"), none = qs.filter((q) => q.kind === "no_answer");
  if (qs.length !== 50) v.push(`total ${qs.length} ≠ 50`);
  if (answer.length !== 40) v.push(`answer ${answer.length} ≠ 40`);
  if (none.length !== 10) v.push(`no_answer ${none.length} ≠ 10`);
  if (new Set(qs.map((q) => q.id)).size !== qs.length) v.push("duplicate ids");
  if (answer.some((q) => q.expected_item_ids.length === 0)) v.push("answer without expected_item_ids");
  if (none.some((q) => q.expected_item_ids.length > 0)) v.push("no_answer with expected_item_ids");
  const dates = answer.filter((q) => q.date_filter).length;
  if (dates < 10) v.push(`date_filter ${dates} < 10`);
  const notTitle = answer.filter((q) => q.title_only_answerable === false).length;
  if (notTitle < 15) v.push(`not_title_only ${notTitle} < 15`);
  for (const s of ["GMAIL", "NOTIFICATION", "SHARE"] as const) {
    const n = answer.filter((q) => q.source === s).length;
    if (n < 3) v.push(`source ${s} ${n} < 3`);
  }
  for (const q of qs) {
    for (const t of q.tags ?? []) {
      if (!Object.hasOwn(TAGS, t)) v.push(`${q.id}: unknown tag ${t}`);
      else if (TAGS[t] !== q.kind) v.push(`${q.id}: tag ${t} needs kind ${TAGS[t]}`);
    }
  }
  return v;
}

export function tagCounts(qs: Question[]): Record<string, number> {
  const c: Record<string, number> = {};
  for (const q of qs) for (const t of q.tags ?? []) c[t] = (c[t] ?? 0) + 1;
  return c;
}

export function scoreQuestion(q: Question, r: ChatResponse): Score {
  const top5 = q.kind === "answer" && r.hits.slice(0, 5).some((h) => q.expected_item_ids.includes(h));
  const inHits = r.hits.some((h) => q.expected_item_ids.includes(h));
  return { id: q.id, top5, refused: r.refused, refusal_ok: q.kind === "no_answer" ? r.refused : !r.refused,
    cited_expected: q.kind === "answer" && r.source_item_ids.some((s) => q.expected_item_ids.includes(s)),
    date_filter_miss: q.kind === "answer" && q.date_filter === true && !inHits, ms: r.ms };
}

export function summarize(s: (Score & { kind: "answer" | "no_answer"; tags?: string[] })[]): Summary {
  const a = s.filter((x) => x.kind === "answer"), n = s.filter((x) => x.kind === "no_answer");
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  const ms = s.map((x) => x.ms).sort((x, y) => x - y);
  const top5 = a.length ? r3(a.filter((x) => x.top5).length / a.length) : 0;
  const refusal = n.length ? r3(n.filter((x) => x.refused).length / n.length) : 0;
  const by_tag: Record<string, TagSummary> = {};
  for (const x of s) {
    for (const t of x.tags ?? []) {
      const b = by_tag[t] ??= { n: 0, top5: 0, refusal_ok: 0 };
      b.n++; b.top5 += x.top5 ? 1 : 0; b.refusal_ok += x.refusal_ok ? 1 : 0;
    }
  }
  return { answer_n: a.length, no_answer_n: n.length, top5_rate: top5, refusal_rate: refusal,
    cited_expected_rate: a.length ? r3(a.filter((x) => x.cited_expected).length / a.length) : 0,
    date_filter_misses: a.filter((x) => x.date_filter_miss).length, p95_ms: ms[Math.max(0, Math.ceil(ms.length * 0.95) - 1)] ?? 0,
    pass: top5 >= 0.9 && refusal >= 0.9, by_tag };
}
