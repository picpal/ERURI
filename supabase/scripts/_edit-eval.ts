// EDIT-eval(스펙 §15, 계획 E5·K4): 합성 문장으로 chat 필터의 edit_event 의도와 고친 칸(서버 재검증 뒤 patch), 추출 경로의 ampm 을 잰다 — 판정·집계 순수 함수.
// 문장 글·칸 값은 출력하지 않는다(id·코드·불리언만). changes 는 재검증 뒤 patch 다 — 모델이 end 를 보내지 않아도(EDIT_RULE: 날짜·시작만 바뀌면
// end null) 서버가 길이를 유지해 같은 patch 가 되므로 e01·e02·e04 의 end 기대값은 그대로다
import { type EditRaw, type EventValues, revalidate, when } from "../functions/chat/edit.ts";
import type { Intent } from "../functions/chat/filters.ts";

export type EditCase = { id: string; group: string; text: string; registered: string | null; mode?: "none" | "edit"; intent: Intent;
  changes?: Partial<EventValues>; measure?: boolean };
export type ExtractCase = { id: string; text: string; ampm: boolean };
export type EditCaseFile = { today: string; registered: Record<string, EventValues>; cases: EditCase[]; extract: ExtractCase[] };
export type EditRow = { id: string; group: string; measure: boolean; expected: Intent; got: Intent; intent_ok: boolean; fields_ok: boolean | null;
  false_edit: boolean; codes: string[] };

export function validateEditCases(f: EditCaseFile): string[] {
  const p: string[] = [];
  const gating = f.cases.filter((c) => !c.measure);
  const edits = gating.filter((c) => c.intent === "edit_event").length, others = gating.length - edits;
  if (edits !== 14) p.push(`edit_event ${edits} != 14`);
  if (others !== 10) p.push(`others ${others} != 10`);
  const ids = new Set<string>();
  for (const c of f.cases) {
    if (ids.has(c.id)) p.push(`${c.id} duplicate`);
    ids.add(c.id);
    if (c.registered !== null && !f.registered[c.registered]) p.push(`${c.id} registered ${c.registered} missing`);
    if (c.intent === "edit_event" && !c.measure && !c.changes) p.push(`${c.id} needs changes`);
    if (c.intent !== "edit_event" && c.changes) p.push(`${c.id} changes only on edit_event`);
  }
  if (f.extract.filter((x) => x.ampm).length !== 4 || f.extract.filter((x) => !x.ampm).length !== 4) p.push("extract must be 4 ambiguous + 4 clear");
  return p;
}

// 칸 판정 = 서버가 실제로 쓸 patch(재검증 뒤)와 기대 changes 의 키·값이 같다. 코드: extra:<칸>·missing:<칸>·wrong:<칸>·start_no_offset(Review Focus 2)
export function judgeEdit(f: EditCaseFile, c: EditCase, got: { intent: Intent; edit: EditRaw | null }): EditRow {
  const base = { id: c.id, group: c.group, measure: c.measure === true, expected: c.intent, got: got.intent, intent_ok: got.intent === c.intent,
    false_edit: c.intent !== "edit_event" && got.intent === "edit_event" };
  if (c.intent !== "edit_event" || !c.changes || c.registered === null) return { ...base, fields_ok: null, codes: [] };
  if (got.intent !== "edit_event") return { ...base, fields_ok: false, codes: ["intent"] };
  const codes: string[] = [];
  if (typeof got.edit?.start === "string" && when(got.edit.start) === null && when(got.edit.start, false) !== null) codes.push("start_no_offset");
  const patch = revalidate(f.registered[c.registered], got.edit).patch as Record<string, unknown>;
  const want = c.changes as Record<string, unknown>;
  for (const k of [...new Set([...Object.keys(patch), ...Object.keys(want)])].sort()) {
    if (!(k in want)) codes.push(`extra:${k}`);
    else if (!(k in patch)) codes.push(`missing:${k}`);
    else if (patch[k] !== want[k]) codes.push(`wrong:${k}`);
  }
  return { ...base, fields_ok: codes.length === 0, codes };
}

// 합격(스펙 §15): 실행마다 의도 일치 ≥ 22/24, edit_event 칸 일치 ≥ 13/14, 다른 의도 → edit_event 0(모든 실행). measure 사례는 집계에서 뺀다
export function summarizeEdit(runs: { run: number; rows: EditRow[] }[]) {
  const per = runs.map(({ run, rows }) => {
    const g = rows.filter((r) => !r.measure);
    return { run, intent: g.filter((r) => r.intent_ok).length, fields: g.filter((r) => r.fields_ok === true).length,
      false_edit: g.filter((r) => r.false_edit).length, measure_ok: rows.filter((r) => r.measure && r.intent_ok).map((r) => r.id) };
  });
  const pass = per.length > 0 && per.every((p) => p.intent >= 22 && p.fields >= 13 && p.false_edit === 0);
  return { gate: pass ? "pass" : "fail", per };
}

export type ExtractGot = { kind: string; uncertain: string[][] };
// 추출 경로 ampm(Codex M8): 모호 = 모든 일정에 ampm, 명확 = 어느 일정에도 ampm 없음. 일정이 없으면 실패(잴 수 없다)
export function extractVerdict(x: ExtractCase, got: ExtractGot): { id: string; ok: boolean; code: string | null } {
  if (got.kind !== "event" || got.uncertain.length === 0) return { id: x.id, ok: false, code: "no_event" };
  const has = got.uncertain.map((u) => u.includes("ampm"));
  if (x.ampm && !has.every(Boolean)) return { id: x.id, ok: false, code: "ampm_missing" };
  if (!x.ampm && has.some(Boolean)) return { id: x.id, ok: false, code: "ampm_extra" };
  return { id: x.id, ok: true, code: null };
}
