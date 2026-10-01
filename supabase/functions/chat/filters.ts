import { openai } from "../_shared/openai.ts";

// 질문 → 검색 필터(스펙 §9 "gpt-6-luna가 필터 추출"). strict json_schema, store:false, effort none. 질문 본문은 로그에 남기지 않는다
export type Filters = { date_from: string | null; date_to: string | null; event_from: string | null; event_to: string | null;
  sources: string[]; kinds: string[]; merchant: string | null };
// 기간은 메일·문자를 받은/저장한 시각(items.occurred_at)이다. 일정·기한 날짜를 여기에 넣으면 9/10 에 받은 10/20 미팅 메일이 빠진다(Ruling D)
const RECEIVED_ONLY = "메일·문자를 받은/저장한 기간을 말할 때만(예: 지난달 받은 메일, 어제 온 문자). 일정·약속·기한의 날짜(예: 10월 20일 미팅, 다음 주 약속, 이번 달 납부)는 null.";
// 일정 날짜(2026-10-01 검색·캘린더 결정): facts 의 event·task 를 이 날짜로 거르고, 일정 질문이면 앱이 이 기간의 기기 캘린더를 읽는다(schedule)
const EVENT_ONLY = "질문이 가리키는 일정·약속·예약·기한의 날짜(예: 내일, 10월 3일, 이번 주 토요일 → 그날 하루, 다음 주 → 그 주 월요일~일요일, 이번 달 → 1일~말일). 일정·기한 날짜가 없거나 받은/저장한 기간이면 null.";
export const FILTER_SCHEMA = {
  type: "object", additionalProperties: false, required: ["date_from", "date_to", "event_from", "event_to", "sources", "kinds", "merchant"],
  properties: {
    date_from: { type: ["string", "null"], description: `${RECEIVED_ONLY} 서울 기준 시작일 YYYY-MM-DD` },
    date_to: { type: ["string", "null"], description: `${RECEIVED_ONLY} 서울 기준 끝 날짜 YYYY-MM-DD(그날 포함)` },
    event_from: { type: ["string", "null"], description: `${EVENT_ONLY} 서울 기준 시작일 YYYY-MM-DD` },
    event_to: { type: ["string", "null"], description: `${EVENT_ONLY} 서울 기준 끝 날짜 YYYY-MM-DD(그날 포함)` },
    sources: { type: "array", items: { type: "string", enum: ["GMAIL", "MESSAGES", "NOTIFICATION", "SHARE"] },
      description: "질문이 출처를 말할 때만: 메일=GMAIL, 문자=MESSAGES와 NOTIFICATION, 카톡·앱 알림=NOTIFICATION, 공유·저장한 것=SHARE. 아니면 빈 배열" },
    kinds: { type: "array", items: { type: "string", enum: ["event", "task", "purchase"] },
      description: "구매·결제·주문 질문=purchase, 일정·약속·예약=event, 할 일·기한=task. 아니면 빈 배열" },
    merchant: { type: ["string", "null"], description: "질문에 가게·판매처·가맹점 이름이 있으면 그 이름, 없으면 null" },
  },
} as const;

export const FILTER_SYSTEM = ["사용자의 개인 비서 검색 질문에서 필터만 뽑는다. 질문에 없는 조건은 만들지 않는다.",
  "date_from·date_to 는 받은/저장한 시각 조건이다. 일정·약속·기한이 언제인지 묻거나 그 날짜로 대상을 가리키면 그 날짜는 event_from·event_to 에, 종류는 kinds 에 넣는다.",
  "받은/저장한 기간과 일정·기한 날짜가 한 질문에 둘 다 있으면(예: 지난달 받은 메일 중 10월 20일 미팅) 둘 다 채운다. 받은 기간이 없으면 date_from·date_to 는 null."].join("\n");

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
// 달력에 있는 YYYY-MM-DD 만. 2026-02-30 은 Postgres timestamptz 변환 오류(500)가 되므로 버린다
function day(s: string | null): string | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? s : null;
}
const bound = (s: string | null, end: boolean) => { const v = day(s); return v ? `${v}T${end ? "23:59:59" : "00:00:00"}+09:00` : null; };

export function normalizeFilters(f: Filters): Filters {
  let ef = bound(f.event_from, false), et = bound(f.event_to, true);
  if (ef && et && Date.parse(ef) > Date.parse(et)) { ef = null; et = null; }        // 거꾸로 된 일정 범위는 버린다
  return { ...f, date_from: bound(f.date_from, false), date_to: bound(f.date_to, true), event_from: ef, event_to: et };
}

// 응답 schedule(스펙 §9 "일정 질문과 기기 캘린더"): 일정 질문(kinds ∋ event)이고 일정 날짜 양 끝이 있으며 31일 이하일 때만
export const SCHEDULE_MAX_DAYS = 31;
export type Schedule = { from: string; to: string };
export function scheduleOf(f: Filters): Schedule | null {
  if (!f.kinds.includes("event") || f.event_from === null || f.event_to === null) return null;
  return (Date.parse(f.event_to) - Date.parse(f.event_from)) / 86_400_000 <= SCHEDULE_MAX_DAYS ? { from: f.event_from, to: f.event_to } : null;
}

export async function extractFilters(question: string, today: string) {
  const weekday = WEEKDAYS[new Date(`${today}T00:00:00Z`).getUTCDay()];            // "이번 주 토요일"·"다음 주" 해석용
  const r = await openai.responses.create({
    model: "gpt-6-luna", store: false, reasoning: { effort: "none" },
    input: [{ role: "system", content: FILTER_SYSTEM },
            { role: "user", content: `오늘(서울): ${today}(${weekday})\n질문: ${question}` }],
    text: { format: { type: "json_schema", name: "search_filters", schema: FILTER_SCHEMA, strict: true } },
  });
  if (r.status === "incomplete") throw new Error("filters incomplete");
  return { filters: normalizeFilters(JSON.parse(r.output_text) as Filters),
    usage: r.usage ? { input_tokens: r.usage.input_tokens, output_tokens: r.usage.output_tokens } : undefined };
}
