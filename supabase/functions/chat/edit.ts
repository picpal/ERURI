import { normalizeDateTime } from "../_shared/extract.ts";

// 방금 등록한 일정 고치기(스펙 §9 "채팅 일정 개선" B 서버 1·4·6, H3 후속 — 계획 2026-10-08-chat-schedule-edit.md E3).
// 모델 출력을 믿지 않는 재검증과 "이번 글이 확인한 uncertain 코드" 규칙. 순수 함수 — 로그·DB 없음(값은 호출부가 로그에 넣지 않는다)
export type EditRaw = { start: string | null; end: string | null; title: string | null; location: string | null };
export type EventValues = { title: string | null; start: string | null; end: string | null; location: string | null };
export type EditStatus = "ok" | "no_change" | "expired" | "not_found" | "multi";
export type EditAction = "create_event" | "update_event";
export type EditResult = { status: EditStatus; before: EventValues | null; after: EventValues | null; proposal_id: string | null; action: EditAction | null };
export type EditTargetRead = { status: "ok"; proposal_id: string; action: EditAction; values: EventValues } | { status: "expired" | "not_found" | "multi" };
export type EditApplied = { status: "ok" | "no_change"; proposal_id: string; action: EditAction; before: EventValues; after: EventValues }
  | { status: "expired" | "not_found" | "multi" };
export type When = { kind: "time" | "day"; value: string; ms: number };
export type Revalidated = { patch: Partial<EventValues>; accepted: { start: boolean; end: boolean; title: boolean; location: boolean } };

export const TITLE_MAX = 100, LOCATION_MAX = 200;
export const UNCERTAIN_CODES = ["year", "ampm", "end", "tz", "date", "location"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OFFSET = /(Z|[+-]\d{2}:?\d{2})$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

// edit_target: uuid 문자열만. 아니면 무시(400 으로 거절하지 않는다 — intents 와 같은 구 앱 보호, 스펙 §9 B 서버)
export function parseEditTarget(v: unknown): string | null { return typeof v === "string" && UUID.test(v) ? v : null; }

// 시각 = 오프셋 있는 ISO(서울 +09:00 로 정규화), 날짜 = 달력에 있는 YYYY-MM-DD(종일). needOffset=false 는 서버가 저장한 지금 값을 읽을 때만
export function when(s: string | null, needOffset = true): When | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (DAY.test(t)) { const n = normalizeDateTime(t); return n.value !== null && n.ms !== null ? { kind: "day", value: n.value, ms: n.ms } : null; }
  if (needOffset && !OFFSET.test(t)) return null;
  const n = normalizeDateTime(t);
  return n.value !== null && n.ms !== null && !DAY.test(n.value) ? { kind: "time", value: n.value, ms: n.ms } : null;
}
const later = (a: When, b: When) => (a.kind === "time" ? a.ms > b.ms : a.value >= b.value);   // 시각은 끝 > 시작, 종일은 마지막 날 ≥ 첫날
const plusDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
const seoulIso = (ms: number) => new Date(ms + 9 * 3600_000).toISOString().slice(0, 19) + "+09:00";
const seoulDay = (w: When) => (w.kind === "day" ? w.value : new Date(w.ms + 9 * 3600_000).toISOString().slice(0, 10));
// 시작을 old → neu 로 옮길 때 끝도 같은 만큼(시각 = 시간 차이, 날짜 = 날 수). 종류가 섞이면 옮기지 못한다(null)
function shifted(end: When, old: When, neu: When): When | null {
  if (end.kind === "time" && old.kind === "time" && neu.kind === "time") return when(seoulIso(end.ms + (neu.ms - old.ms)));
  if (end.kind === "day" && old.kind === "day" && neu.kind === "day") return when(plusDays(end.value, daysBetween(old.value, neu.value)));
  return null;
}

// 스펙 §9 B 서버 4: 해석이 안 되는 칸은 버리고, 남은 칸으로 시작·끝을 다시 맞춘 뒤 지금 값과 다른 칸만 patch.
// accepted = 그 칸이 와서 받아들여졌다(confirmedCodes 가 쓴다 — 값이 같아도 "사용자가 말했다")
export function revalidate(cur: EventValues, raw: EditRaw | null): Revalidated {
  const accepted = { start: false, end: false, title: false, location: false };
  const patch: Partial<EventValues> = {};
  if (!raw) return { patch, accepted };
  if (typeof raw.title === "string") {
    const t = raw.title.trim();
    if (t.length >= 1 && t.length <= TITLE_MAX) { accepted.title = true; if (t !== (cur.title ?? "").trim()) patch.title = t; }
  }
  if (typeof raw.location === "string") {
    const l = raw.location.trim();
    if (l.length <= LOCATION_MAX) { accepted.location = true; const v = l === "" ? null : l; if (v !== (cur.location ?? null)) patch.location = v; }
  }
  const cs = when(cur.start, false);
  if (cs === null) return { patch, accepted };                  // 지금 시작을 못 읽으면 시각은 고치지 않는다(시작 없는 제안은 C 날짜 선택)
  const ce = when(cur.end, false), ns = when(raw.start), ne = when(raw.end);
  if (ns) accepted.start = true;
  const start = ns ?? cs;
  let end: When | null;
  if (ne && ne.kind === start.kind && later(ne, start)) { end = ne; accepted.end = true; }
  else if (ns && ns.kind !== cs.kind) end = null;             // 종일 ↔ 시각인데 쓸 끝이 없다 → 끝 없음(시각은 §10 기본 길이)
  else if (ns && ce) end = shifted(ce, cs, ns);              // 시작만 옮김(또는 끝을 버림) → 원래 길이 유지
  else end = ce;
  if (end && !later(end, start)) end = null;
  if (start.value !== cs.value) patch.start = start.value;
  if ((end?.value ?? null) !== (ce?.value ?? null)) patch.end = end?.value ?? null;
  return { patch, accepted };
}

// 오전·오후 표지(사용자 결정 "H3 후속"): 낱말 오전·오후·아침·저녁·밤·새벽, 또는 13~23시(13시 … 23시, 13:00 … 23:59). 이번 글만 본다 — 맥락·<registered> 블록은 보지 않는다
const AMPM_WORD = /오전|오후|아침|저녁|밤|새벽/;
const H24 = /(?:^|[^\d])(?:1[3-9]|2[0-3])\s*시|(?:^|[^\d])(?:1[3-9]|2[0-3]):[0-5]\d/;
export function ampmMarked(message: string): boolean { return AMPM_WORD.test(message) || H24.test(message); }

// B와의 관계(Codex H3·H3 후속): 이번 글이 확인했다고 볼 수 있는 코드만 — date = 시작의 서울 날짜가 바뀜, location·end = 그 칸이 와서 받아들여짐
// (시작만 옮겨 서버가 따라 옮긴 끝은 아님), ampm = 받아들인 start 가 왔고 이번 글에 표지. year·tz 는 빼지 않는다(C 버튼이 묻는다)
export function confirmedCodes(cur: EventValues, r: Revalidated, message: string): string[] {
  const out: string[] = [];
  const cs = when(cur.start, false), ns = r.patch.start ? when(r.patch.start) : null;
  if (ns && (!cs || seoulDay(ns) !== seoulDay(cs))) out.push("date");
  if (r.accepted.location) out.push("location");
  if (r.accepted.end) out.push("end");
  if (r.accepted.start && ampmMarked(message)) out.push("ampm");
  return out;
}

const str = (x: unknown) => (typeof x === "string" ? x : null);
const values = (o: Record<string, unknown>): EventValues => ({ title: str(o.title), start: str(o.start), end: str(o.end), location: str(o.location) });
const isAction = (x: unknown): x is EditAction => x === "create_event" || x === "update_event";
// chat_edit_target(0033) 행. 형식이 틀리면 not_found — 쓰기 전 단계라 응답 모양만 지킨다
export function parseTargetRow(v: unknown): EditTargetRead {
  const o = (v ?? {}) as Record<string, unknown>;
  if (o.status === "expired" || o.status === "multi" || o.status === "not_found") return { status: o.status };
  if (o.status === "ok" && typeof o.proposal_id === "string" && isAction(o.action)) return { status: "ok", proposal_id: o.proposal_id, action: o.action, values: values(o) };
  return { status: "not_found" };
}
// chat_edit_proposal(0033) 행. ok·no_change 인데 칸이 빠졌으면 던진다(500 — 썼을 수 있는 응답을 not_found 로 감추지 않는다)
export function parseApplyRow(v: unknown): EditApplied {
  const o = (v ?? {}) as Record<string, unknown>;
  if (o.status === "expired" || o.status === "multi" || o.status === "not_found") return { status: o.status };
  if ((o.status === "ok" || o.status === "no_change") && typeof o.proposal_id === "string" && isAction(o.action)
      && typeof o.before === "object" && o.before !== null && typeof o.after === "object" && o.after !== null) {
    return { status: o.status, proposal_id: o.proposal_id, action: o.action, before: values(o.before as Record<string, unknown>), after: values(o.after as Record<string, unknown>) };
  }
  throw new Error("chat_edit_proposal bad_row");
}
