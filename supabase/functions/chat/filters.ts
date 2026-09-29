import { openai } from "../_shared/openai.ts";

// 질문 → 검색 필터(스펙 §9 "gpt-6-luna가 필터 추출"). strict json_schema, store:false, effort none. 질문 본문은 로그에 남기지 않는다
export type Filters = { date_from: string | null; date_to: string | null; sources: string[]; kinds: string[]; merchant: string | null };
export const FILTER_SCHEMA = {
  type: "object", additionalProperties: false, required: ["date_from", "date_to", "sources", "kinds", "merchant"],
  properties: {
    date_from: { type: ["string", "null"], description: "질문이 기간·날짜를 말할 때만. 서울 기준 시작일 YYYY-MM-DD" },
    date_to: { type: ["string", "null"], description: "질문이 기간·날짜를 말할 때만. 서울 기준 끝 날짜 YYYY-MM-DD(그날 포함)" },
    sources: { type: "array", items: { type: "string", enum: ["GMAIL", "MESSAGES", "NOTIFICATION", "SHARE"] },
      description: "질문이 출처를 말할 때만: 메일=GMAIL, 문자=MESSAGES와 NOTIFICATION, 카톡·앱 알림=NOTIFICATION, 공유·저장한 것=SHARE. 아니면 빈 배열" },
    kinds: { type: "array", items: { type: "string", enum: ["event", "task", "purchase"] },
      description: "구매·결제·주문 질문=purchase, 일정·약속·예약=event, 할 일·기한=task. 아니면 빈 배열" },
    merchant: { type: ["string", "null"], description: "질문에 가게·판매처·가맹점 이름이 있으면 그 이름, 없으면 null" },
  },
} as const;

export function normalizeFilters(f: Filters): Filters {
  const d = (s: string | null, end: boolean) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T${end ? "23:59:59" : "00:00:00"}+09:00` : null);
  return { ...f, date_from: d(f.date_from, false), date_to: d(f.date_to, true) };
}

export async function extractFilters(question: string, today: string) {
  const r = await openai.responses.create({
    model: "gpt-6-luna", store: false, reasoning: { effort: "none" },
    input: [{ role: "system", content: "사용자의 개인 비서 검색 질문에서 필터만 뽑는다. 질문에 없는 조건은 만들지 않는다." },
            { role: "user", content: `오늘(서울): ${today}\n질문: ${question}` }],
    text: { format: { type: "json_schema", name: "search_filters", schema: FILTER_SCHEMA, strict: true } },
  });
  if (r.status === "incomplete") throw new Error("filters incomplete");
  return { filters: normalizeFilters(JSON.parse(r.output_text) as Filters),
    usage: r.usage ? { input_tokens: r.usage.input_tokens, output_tokens: r.usage.output_tokens } : undefined };
}
