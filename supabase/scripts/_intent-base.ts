import { MAIL_READ_COUNT_RULES } from "../functions/chat/filters.ts";

// INTENT 회귀 기준선(DP15): 0.19.0 필터 요청에서 mail_read.count 칸과 지시 세 줄을 빼면 0.18.x 요청과 바이트 동일하다(chat-agg-filters 고정 해시가 증명)
const TAIL = "\n" + MAIL_READ_COUNT_RULES.join("\n");
export function stripCount(req: unknown): unknown {
  return JSON.parse(JSON.stringify(req), (_k, v) => {
    if (typeof v === "string") return v.includes(TAIL) ? v.replace(TAIL, "") : v;
    if (v && typeof v === "object" && !Array.isArray(v) && Array.isArray(v.required) && v.required.includes("count") && v.required.includes("target_in_message")) {
      const { count: _c, ...props } = v.properties;
      return { ...v, required: v.required.filter((x: string) => x !== "count"), properties: props };
    }
    return v;
  });
}
