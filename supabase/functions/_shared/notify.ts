import type { APNsResult } from "./apns.ts";
import { seoulToday, WEEKDAYS_KO } from "./time.ts";

// 제안 푸시 계획(스펙 §7 notify, §10 페이로드, 0b). 기존 iOS NotificationActions 계약: category ADD_EVENT + 최상위 proposal_id·version·title·start.
// 묶음(2026-10-01): 한 항목의 푸시 가능한 일정이 2건 이상이면 category EVENT_BUNDLE(잠금화면 액션 없음) + 최상위 대표 키 + events[{proposal_id,version,title,start,category}].
// 알림 문구는 추출 제목·일시만(원문 본문 금지, §12)
export type ProposalRow = { id: string; action: string; payload: Record<string, unknown>; status: string; version: number;
  occurred_at: string | null; captured_at: string | null };
export const BACKFILL_MS = 3 * 24 * 3600_000;
type Skip = "not_proposed" | "backfill" | "past" | "unsupported";
export const BUNDLE_CATEGORY = "EVENT_BUNDLE";
export type PushPlan = { skip: Skip }
  | { skip: null; category: "ADD_EVENT" | "REVIEW" | "ADD_REMINDER" | typeof BUNDLE_CATEGORY; payload: Record<string, unknown> };

const hasTime = (s: string) => /T\d{2}:\d{2}/.test(s);
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
    const category = uncertain.length === 0 && hasTime(start) ? "ADD_EVENT" : "REVIEW";
    return { skip: null, category, payload: {
      aps: { alert: { title: category === "ADD_EVENT" ? "일정 제안" : "일정 확인 필요", body: `${whenLabel(start)} · ${title}` }, category, sound: "default" },
      proposal_id: p.id, version: p.version, title, start } };
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

// 묶음 알림(스펙 §7 notify·§10, 2026-10-01): 한 항목의 제안들 중 푸시할 수 있는 일정만. 0건 → 순번 0 의 건너뜀 사유,
// 1건 → 기존 단건 페이로드 그대로(잠금화면 "캘린더에 추가" 유지), 2건 이상 → EVENT_BUNDLE 1건(액션 없음, 탭 → 시트 N장)
export function planBundlePush(rows: ProposalRow[], now: Date): PushPlan {
  const ready: { p: Extract<PushPlan, { skip: null }> }[] = [];
  for (const r of rows) {
    const p = planProposalPush(r, now);
    if (p.skip === null) ready.push({ p });
  }
  if (ready.length === 0) return rows.length > 0 ? planProposalPush(rows[0], now) : { skip: "not_proposed" };
  if (ready.length === 1 || ready.some((x) => x.p.category === "ADD_REMINDER")) return ready[0].p;
  ready.sort((a, b) => startMs(String(a.p.payload.start)) - startMs(String(b.p.payload.start)));
  const n = ready.length, first = ready[0].p.payload;
  return { skip: null, category: BUNDLE_CATEGORY, payload: {
    aps: { alert: { title: `일정 제안 ${n}건`, body: `${whenLabel(String(first.start))} · ${first.title} 외 ${n - 1}건` },
      category: BUNDLE_CATEGORY, sound: "default" },
    proposal_id: first.proposal_id, version: first.version, title: first.title, start: first.start,
    events: ready.map(({ p }) => ({ proposal_id: p.payload.proposal_id, version: p.payload.version, title: p.payload.title,
      start: p.payload.start, category: p.category })) } };
}

// 토큰·요청 자체가 틀린 응답은 다시 보내도 같다(Apple 문서 상태 코드). 429·5xx 는 일시 오류
export function isPermanentFailure(r: APNsResult): boolean {
  return [400, 403, 404, 410, 413].includes(r.status);
}
