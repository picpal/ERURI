import { openai } from "../_shared/openai.ts";

// 질문 → 검색 필터(스펙 §9 "gpt-6-luna가 필터 추출"). strict json_schema, store:false, effort none. 질문 본문은 로그에 남기지 않는다
export type Filters = { date_from: string | null; date_to: string | null; sources: string[]; kinds: string[]; merchant: string | null };
// 기간은 메일·문자를 받은/저장한 시각(items.occurred_at)이다. 일정·기한 날짜를 여기에 넣으면 9/10 에 받은 10/20 미팅 메일이 빠진다(Ruling D)
const RECEIVED_ONLY = "메일·문자를 받은/저장한 기간을 말할 때만(예: 지난달 받은 메일, 어제 온 문자). 일정·약속·기한의 날짜(예: 10월 20일 미팅, 다음 주 약속, 이번 달 납부)는 null.";
export const FILTER_SCHEMA = {
  type: "object", additionalProperties: false, required: ["date_from", "date_to", "sources", "kinds", "merchant"],
  properties: {
    date_from: { type: ["string", "null"], description: `${RECEIVED_ONLY} 서울 기준 시작일 YYYY-MM-DD` },
    date_to: { type: ["string", "null"], description: `${RECEIVED_ONLY} 서울 기준 끝 날짜 YYYY-MM-DD(그날 포함)` },
    sources: { type: "array", items: { type: "string", enum: ["GMAIL", "MESSAGES", "NOTIFICATION", "SHARE"] },
      description: "질문이 출처를 말할 때만: 메일=GMAIL, 문자=MESSAGES와 NOTIFICATION, 카톡·앱 알림=NOTIFICATION, 공유·저장한 것=SHARE. 아니면 빈 배열" },
    kinds: { type: "array", items: { type: "string", enum: ["event", "task", "purchase"] },
      description: "구매·결제·주문 질문=purchase, 일정·약속·예약=event, 할 일·기한=task. 아니면 빈 배열" },
    merchant: { type: ["string", "null"], description: "질문에 가게·판매처·가맹점 이름이 있으면 그 이름, 없으면 null" },
  },
} as const;

export const FILTER_SYSTEM = ["사용자의 개인 비서 검색 질문에서 필터만 뽑는다. 질문에 없는 조건은 만들지 않는다.",
  "date_from·date_to 는 받은/저장한 시각 조건이다. 일정·약속·기한이 언제인지 묻거나 그 날짜로 대상을 가리키면 날짜는 null 로 두고 kinds 로만 표시한다."].join("\n");

export function normalizeFilters(f: Filters): Filters {
  const d = (s: string | null, end: boolean) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T${end ? "23:59:59" : "00:00:00"}+09:00` : null);
  return { ...f, date_from: d(f.date_from, false), date_to: d(f.date_to, true) };
}

export async function extractFilters(question: string, today: string) {
  const r = await openai.responses.create({
    model: "gpt-6-luna", store: false, reasoning: { effort: "none" },
    input: [{ role: "system", content: FILTER_SYSTEM },
            { role: "user", content: `오늘(서울): ${today}\n질문: ${question}` }],
    text: { format: { type: "json_schema", name: "search_filters", schema: FILTER_SCHEMA, strict: true } },
  });
  if (r.status === "incomplete") throw new Error("filters incomplete");
  return { filters: normalizeFilters(JSON.parse(r.output_text) as Filters),
    usage: r.usage ? { input_tokens: r.usage.input_tokens, output_tokens: r.usage.output_tokens } : undefined };
}
