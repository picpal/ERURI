import { responseUsage, type TokenUsage } from "./budget.ts";
import { openai } from "./openai.ts";
import { seoulToday } from "./time.ts";
export { seoulToday };

// 이미지·PDF·OCR 텍스트 → 일정 후보(Task 12, 스펙 §7). gpt-6-luna, Responses API Structured Outputs(strict), store: false.
// 로그·오류 메시지에 추출값·본문을 넣지 않는다
export const EXTRACT_MODEL = "gpt-6-luna";
export const UNCERTAIN = ["year", "ampm", "end", "tz", "date", "location"] as const;

// strict 스키마: 모든 객체 additionalProperties false, 모든 필드 required, nullable은 타입 배열(스펙 §3)
export const EVENT_SCHEMA = {
  type: "object", additionalProperties: false, required: ["title", "start", "end", "location", "uncertain", "year_in_text", "lunar"],
  properties: {
    title: { type: ["string", "null"], description: "일정 제목. 예: '김민준·이서연 결혼식', '동창회'" },
    start: { type: ["string", "null"], description: "시작 일시 ISO 8601, Asia/Seoul(+09:00). 시각이 없으면 YYYY-MM-DD" },
    end: { type: ["string", "null"], description: "종료 일시. 명시돼 있을 때만" },
    location: { type: ["string", "null"], description: "장소명과 층·홀. 주소는 장소명이 없을 때만" },
    uncertain: { type: "array", items: { type: "string", enum: [...UNCERTAIN] } },
    // 서버가 uncertain을 결정적으로 채우기 위한 사실 플래그(결과에는 남기지 않는다). 모델의 uncertain 판단은 흔들린다(Task 12 실측)
    year_in_text: { type: "boolean", description: "행사 날짜의 연도가 문서에 적혀 있으면 true" },
    lunar: { type: "boolean", description: "행사 날짜가 음력으로만 적혀 있으면 true" },
  },
} as const;

export type ExtractedEvent = { title: string | null; start: string | null; end: string | null; location: string | null; uncertain: string[] };
type RawEvent = ExtractedEvent & { year_in_text?: boolean; lunar?: boolean };
export type ExtractInput = { imageBase64?: string; mediaType?: "image/jpeg" | "image/png"; pdfBase64?: string; ocrText?: string };
export type ExtractUsage = { input_tokens: number; output_tokens: number };

const INSTRUCTION = (today: string) => [
  `오늘은 ${today}(Asia/Seoul)이다. 이 청첩장·행사 안내에서 본 행사의 제목, 시작·종료 일시, 장소를 추출하라.`,
  "- 식사·접수·회신 기한·입금 마감·발행일 같은 부수 일시는 시작 일시가 아니다.",
  "- 일시는 ISO 8601 +09:00으로 쓴다. 연도가 없으면 오늘 이후 가장 가까운 해로 채우고 uncertain에 year를 넣어라.",
  "- 오전/오후가 불명확하면 ampm을 넣어라. '낮 12시'는 12:00이다.",
  "- 종료 시각이 문서에 없으면 end는 null이고 uncertain에 넣지 않는다. 종료가 적혀 있는데 해석이 모호할 때만 end를 넣는다.",
  "- uncertain은 실제로 추측한 항목만 넣는다. 문서에 명확히 적힌 값은 넣지 않는다.",
  "- 음력 날짜만 있으면 양력으로 환산하되 확신이 없으면 uncertain에 date를 넣어라.",
  "- 청첩장 제목은 신랑·신부 이름으로 짓는다(혼주 부모 이름이 아니다).",
  "- 문서에 없는 값은 지어내지 말고 null로 둔다.",
].join("\n");

export function buildExtractRequest(input: ExtractInput, today: string) {
  const content: ({ type: "input_image"; detail: "high"; image_url: string } | { type: "input_file"; filename: string; file_data: string } |
    { type: "input_text"; text: string })[] = [];
  if (input.imageBase64) content.push({ type: "input_image", detail: "high", image_url: `data:${input.mediaType ?? "image/jpeg"};base64,${input.imageBase64}` });
  if (input.pdfBase64) content.push({ type: "input_file", filename: "notice.pdf", file_data: `data:application/pdf;base64,${input.pdfBase64}` });
  if (input.ocrText) content.push({ type: "input_text", text: "기기 OCR 텍스트:\n" + input.ocrText });
  if (content.length === 0) throw new Error("extract empty_input");
  content.push({ type: "input_text", text: INSTRUCTION(today) });
  return {
    model: EXTRACT_MODEL, store: false as const, reasoning: { effort: "none" as const }, max_output_tokens: 512,
    input: [{ role: "user" as const, content }],
    text: { format: { type: "json_schema" as const, name: "event", schema: EVENT_SCHEMA, strict: true } },
  };
}

// ── 정규화: ISO 8601 + Asia/Seoul ──
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

function toSeoulIso(ms: number): string {
  return new Date(ms + 9 * 3600_000).toISOString().slice(0, 19) + "+09:00";
}
// 날짜만이면 그대로(종일), 오프셋 없으면 서울 현지 시각, 오프셋 있으면 서울로 변환. 해석 못 하면 null
export function normalizeDateTime(v: string | null): { value: string | null; ms: number | null } {
  if (v === null) return { value: null, ms: null };
  const s = v.trim();
  const d = s.match(DATE_ONLY);
  if (d) {
    const ms = Date.parse(`${s}T00:00:00+09:00`);
    return Number.isFinite(ms) && new Date(ms + 9 * 3600_000).toISOString().startsWith(s) ? { value: s, ms } : { value: null, ms: null };
  }
  const m = s.match(DATE_TIME);
  if (!m) return { value: null, ms: null };
  const off = m[5] === undefined ? "+09:00" : m[5] === "Z" ? "Z" : m[5].replace(/^([+-]\d{2}):?(\d{2})$/, "$1:$2");
  const ms = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4] ?? "00"}${off}`);
  return Number.isFinite(ms) ? { value: toSeoulIso(ms), ms } : { value: null, ms: null };
}

export const clean = (s: string | null) => (s === null ? null : s.trim().replace(/\s+/g, " ") || null);

// 연도 표기가 없으면 연도는 서버가 정한다: 오늘(서울) 이후 가장 가까운 해. 모델은 가끔 내년으로 채운다(Task 12 실측 1/3)
function nearestFutureYear(value: string, today: string): number {
  const y = Number(today.slice(0, 4));
  return `${y}-${value.slice(5, 10)}` >= today ? y : y + 1;
}
const withYear = (value: string | null, y: number) => (value === null ? null : String(y).padStart(4, "0") + value.slice(4));

export function normalizeEvent(raw: RawEvent, today = seoulToday()): ExtractedEvent {
  const uncertain = new Set(raw.uncertain.filter((u) => (UNCERTAIN as readonly string[]).includes(u)));
  if (raw.year_in_text === false && raw.start !== null) uncertain.add("year");
  if (raw.lunar === true) uncertain.add("date");                         // 음력 환산은 사용자 확인(실측에서 하루 틀린 사례)
  let start = normalizeDateTime(raw.start);
  if (start.value === null) uncertain.add("date");
  let end = normalizeDateTime(raw.end);
  if (raw.year_in_text === false && start.value !== null) {
    const shift = nearestFutureYear(start.value, today) - Number(start.value.slice(0, 4));
    if (shift !== 0) {
      start = normalizeDateTime(withYear(start.value, Number(start.value.slice(0, 4)) + shift));
      if (end.value !== null) end = normalizeDateTime(withYear(end.value, Number(end.value.slice(0, 4)) + shift));
    }
  }
  if (raw.end !== null && end.value === null) uncertain.add("end");
  if (end.ms !== null && start.ms !== null && end.ms < start.ms) { end = { value: null, ms: null }; uncertain.add("end"); }
  return { title: clean(raw.title), start: start.value, end: end.value, location: clean(raw.location), uncertain: [...uncertain] };
}

export type RawResponse = {
  status?: string; incomplete_details?: { reason?: string } | null; output_text: string;
  output: { type: string; content?: { type: string }[] }[];
};
// 잘림·거절은 파싱하지 않고 실패로 돌린다. 오류 메시지에 본문을 넣지 않는다. 이미지·텍스트 추출과 분류 어댑터가 같이 쓴다
export function parseStructured(r: RawResponse): unknown {
  if (r.status !== "completed") throw new Error(`openai ${r.status} ${r.incomplete_details?.reason ?? ""}`.trim());
  if (r.output.some((o) => o.type === "message" && o.content?.some((c) => c.type === "refusal"))) throw new Error("openai refusal");
  try { return JSON.parse(r.output_text); } catch { throw new Error("openai bad_json"); }
}

export function parseExtractResponse(r: RawResponse, today = seoulToday()): ExtractedEvent {
  return normalizeEvent(parseStructured(r) as RawEvent, today);
}

// 측정·토큰 정산용. extractEvent는 계획서 시그니처 그대로 결과만 돌려준다
export async function extractEventDetailed(input: ExtractInput, today = seoulToday(), onUsage?: (u: TokenUsage | null) => void):
  Promise<{ event: ExtractedEvent; usage: ExtractUsage; ms: number }> {
  const t0 = performance.now();
  const r = await openai.responses.create(buildExtractRequest(input, today));
  onUsage?.(responseUsage(r));                                      // 파싱 전(§13 — 거절·잘림도 청구된 토큰)
  const event = parseExtractResponse(r as unknown as RawResponse, today);
  return { event, usage: { input_tokens: r.usage?.input_tokens ?? 0, output_tokens: r.usage?.output_tokens ?? 0 }, ms: Math.round(performance.now() - t0) };
}

export async function extractEvent(input: ExtractInput): Promise<ExtractedEvent> {
  return (await extractEventDetailed(input)).event;
}
