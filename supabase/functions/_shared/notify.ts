import type { APNsResult } from "./apns.ts";
import { seoulToday, WEEKDAYS_KO } from "./time.ts";

// 제안 푸시 계획(스펙 §7 notify, §10 페이로드, 0b). 기존 iOS NotificationActions 계약: category ADD_EVENT + 최상위 proposal_id·version·title·start.
// 묶음(2026-10-01): 한 항목의 푸시 가능한 일정이 2건 이상이면 category EVENT_BUNDLE(잠금화면 액션 없음) + 최상위 대표 키 + events[{proposal_id,version,title,start,category}].
// 종일(0.9.1, 사용자 결정 A): 날짜만인 start(YYYY-MM-DD)도 uncertain 이 없으면 ADD_EVENT — start 는 날짜 그대로, 여러 날이면 end(마지막 날, 서울 YYYY-MM-DD)를 싣는다.
// 알림 문구는 추출 제목·일시만(원문 본문 금지, §12)
export type ProposalRow = { id: string; action: string; payload: Record<string, unknown>; status: string; version: number;
  occurred_at: string | null; captured_at: string | null };
export const BACKFILL_MS = 3 * 24 * 3600_000;
type Skip = "not_proposed" | "backfill" | "past" | "unsupported" | "duplicate";
// 같은 사용자의 다른 항목에 먼저 생긴 대기(proposed) 일정 제안(worker_pending_event_peers, 0027). start·title 은 payload 원문
export type PeerProposal = { start: string | null; title: string | null };
export const BUNDLE_CATEGORY = "EVENT_BUNDLE";
export type PushPlan = { skip: Skip }
  | { skip: null; category: "ADD_EVENT" | "REVIEW" | "ADD_REMINDER" | typeof BUNDLE_CATEGORY; payload: Record<string, unknown> };

const hasTime = (s: string) => /T\d{2}:\d{2}/.test(s);
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

// "2026-10-02T15:30:00+09:00" → "10월 2일(금) 15:30", "2026-10-24" → "10월 24일(토)"
export function whenLabel(iso: string): string {
  const s = new Date(Date.parse(hasTime(iso) ? iso : `${iso}T00:00:00+09:00`) + 9 * 3600_000);   // 서울 벽시계
  const md = `${s.getUTCMonth() + 1}월 ${s.getUTCDate()}일(${WEEKDAYS_KO[s.getUTCDay()]})`;
  return hasTime(iso) ? `${md} ${String(s.getUTCHours()).padStart(2, "0")}:${String(s.getUTCMinutes()).padStart(2, "0")}` : md;
}

// 시각이 있으면 지금과 비교, 날짜만이면 오늘(서울)은 지나지 않은 것으로 본다
function isPast(iso: string, now: Date): boolean {
  return hasTime(iso) ? Date.parse(iso) < now.getTime() : iso.slice(0, 10) < seoulToday(now);
}

// 종일 일정의 마지막 날(서울 YYYY-MM-DD). 시작 다음 날 이후일 때만 — 하루짜리·거꾸로·해석 불가는 null(앱은 그날 하루로 넣는다).
// 추출 값은 +09:00 으로 정규화돼 있어(§7) 시각 있는 end 도 앞 10자가 서울 날짜다
function allDayEnd(start: string, end: string | null): string | null {
  if (end === null) return null;
  const day = DATE_ONLY.test(end) ? end : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?\+09:00$/.test(end) ? end.slice(0, 10) : null;
  return day !== null && day > start && Number.isFinite(Date.parse(`${day}T00:00:00+09:00`)) ? day : null;
}

export function planProposalPush(p: ProposalRow, now: Date): PushPlan {
  if (p.status !== "proposed") return { skip: "not_proposed" };
  if (p.occurred_at && p.captured_at && Date.parse(p.captured_at) - Date.parse(p.occurred_at) >= BACKFILL_MS) return { skip: "backfill" };
  const pl = p.payload;
  if (p.action === "create_event") {
    const start = str(pl.start);
    if (start === null) return { skip: "unsupported" };
    if (isPast(start, now)) return { skip: "past" };
    const title = clip(str(pl.title) ?? "일정", 40);
    const uncertain = Array.isArray(pl.uncertain) ? pl.uncertain : [];
    const allDay = DATE_ONLY.test(start);
    const category = uncertain.length === 0 && (hasTime(start) || allDay) ? "ADD_EVENT" : "REVIEW";
    const end = category === "ADD_EVENT" && allDay ? allDayEnd(start, str(pl.end)) : null;
    return { skip: null, category, payload: {
      aps: { alert: { title: category === "ADD_EVENT" ? "일정 제안" : "일정 확인 필요", body: `${whenLabel(start)} · ${title}` }, category, sound: "default" },
      proposal_id: p.id, version: p.version, title, start, ...(end ? { end } : {}) } };
  }
  if (p.action === "create_reminder") {
    const due = str(pl.due);
    if (due !== null && isPast(due, now)) return { skip: "past" };
    const title = clip(str(pl.title) ?? "할 일", 40);
    return { skip: null, category: "ADD_REMINDER", payload: {
      aps: { alert: { title: "할 일 제안", body: due ? `${title} · ${whenLabel(due)}까지` : title }, category: "ADD_REMINDER", sound: "default" },
      proposal_id: p.id, version: p.version, title, ...(due ? { due } : {}) } };
  }
  return { skip: "unsupported" };
}

const startMs = (iso: string) => Date.parse(hasTime(iso) ? iso : `${iso}T00:00:00+09:00`);

// 제목 비교 키(스펙 §7 notify 중복, 0.9.2): 소문자, 글자·숫자만(공백·기호·괄호 제거 — 문자 L·M, 숫자 Nd = Swift CharacterSet.letters·decimalDigits). 앱 EruriCore TitleMatch.normalize 와 같은 규칙
export function titleKey(s: string): string {
  return s.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{M}\p{Nd}]/gu, "");
}
// 서울 시작 날짜 + 정규화 제목. 추출 값은 +09:00 으로 정규화돼 있어(§7) 앞 10자가 서울 날짜다. 제목이 비면 키 없음(중복으로 보지 않는다)
function dupKey(start: string | null, title: string | null): string | null {
  const t = titleKey(title ?? "");
  return start && t ? `${start.slice(0, 10)}|${t}` : null;
}

// 묶음 알림(스펙 §7 notify·§10, 2026-10-01): 한 항목의 제안들 중 푸시할 수 있는 일정만. 0건 → 순번 0 의 건너뜀 사유,
// 1건 → 기존 단건 페이로드 그대로(잠금화면 "캘린더에 추가" 유지), 2건 이상 → EVENT_BUNDLE 1건(액션 없음, 탭 → 시트 N장).
// 중복(0.9.2): 다른 항목의 먼저 생긴 대기 제안(peers)과 서울 시작 날짜·정규화 제목이 같으면 그 일정은 뺀다(제안은 남는다 — 목록·채팅에는 보인다).
// 남은 것만으로 단건·묶음을 정하고, 중복 때문에 0건이면 "duplicate"
export function planBundlePush(rows: ProposalRow[], now: Date, peers: PeerProposal[] = []): PushPlan {
  const taken = new Set(peers.map((x) => dupKey(x.start, x.title)).filter((k): k is string => k !== null));
  const ready: { p: Extract<PushPlan, { skip: null }> }[] = [];
  let dropped = 0;
  for (const r of rows) {
    const p = planProposalPush(r, now);
    if (p.skip !== null) continue;
    const k = r.action === "create_event" ? dupKey(str(r.payload.start), str(r.payload.title)) : null;
    if (k !== null && taken.has(k)) { dropped++; continue; }
    ready.push({ p });
  }
  if (ready.length === 0) {
    if (dropped > 0) return { skip: "duplicate" };
    return rows.length > 0 ? planProposalPush(rows[0], now) : { skip: "not_proposed" };
  }
  if (ready.length === 1 || ready.some((x) => x.p.category === "ADD_REMINDER")) return ready[0].p;
  ready.sort((a, b) => startMs(String(a.p.payload.start)) - startMs(String(b.p.payload.start)));
  const n = ready.length, first = ready[0].p.payload;
  return { skip: null, category: BUNDLE_CATEGORY, payload: {
    aps: { alert: { title: `일정 제안 ${n}건`, body: `${whenLabel(String(first.start))} · ${first.title} 외 ${n - 1}건` },
      category: BUNDLE_CATEGORY, sound: "default" },
    proposal_id: first.proposal_id, version: first.version, title: first.title, start: first.start,
    events: ready.map(({ p }) => ({ proposal_id: p.payload.proposal_id, version: p.payload.version, title: p.payload.title,
      start: p.payload.start, ...(p.payload.end ? { end: p.payload.end } : {}), category: p.category })) } };
}

// 토큰·요청 자체가 틀린 응답은 다시 보내도 같다(Apple 문서 상태 코드). 429·5xx 는 일시 오류
export function isPermanentFailure(r: APNsResult): boolean {
  return [400, 403, 404, 410, 413].includes(r.status);
}
