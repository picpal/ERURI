import type { ClassifyLabel } from "../supabase/functions/_shared/classify.ts";
import { WEEKDAYS_KO } from "../supabase/functions/_shared/time.ts";

// 09-29 실기기 PoC-3 10문구 = eval/phrases.json 의 device10 항목(d01~d10, Jev 평가와 같은 합성 문구 — 실제 메일·문자가 아니다).
// 서버 기대값(규칙 판정·허용 추출 종류)은 여기서 붙인다. phrases.json 은 Jev 평가 원자료라 고치지 않는다
type Raw = { id: string; label: ClassifyLabel; text: string; device10?: { topic: string; device: string } };
export type Kind = "event" | "task" | "purchase";
export type Phrase = { id: string; label: ClassifyLabel; text: string; topic: string; device: string; rules: "pass" | "otp" | "promotion"; kinds: Kind[] };

const EXPECT: Record<string, { rules: Phrase["rules"]; kinds: Kind[] }> = {
  d01: { rules: "pass", kinds: ["purchase", "event"] },   // 택배 도착 예정
  d02: { rules: "pass", kinds: ["event"] },               // 병원 예약
  d03: { rules: "pass", kinds: ["purchase"] },            // 카드 승인
  d04: { rules: "pass", kinds: ["event"] },               // 컨퍼런스
  d05: { rules: "pass", kinds: ["task", "purchase"] },    // 공과금 납부기한
  d06: { rules: "promotion", kinds: [] },                 // (광고)
  d07: { rules: "otp", kinds: [] },                       // 인증번호 [482913]
  d08: { rules: "pass", kinds: ["event"] },               // 목요일 판교 약속
  d09: { rules: "pass", kinds: [] },                      // 잡담
  d10: { rules: "pass", kinds: [] },                      // 잡담
};
const RAW: Raw[] = JSON.parse(Deno.readTextFileSync(new URL("./phrases.json", import.meta.url))).phrases;
export const DEVICE10: Phrase[] = RAW.filter((p) => p.device10).map((p) => ({ id: p.id, label: p.label, text: p.text,
  topic: p.device10!.topic, device: p.device10!.device, ...EXPECT[p.id] }));

// PoC-5(Task 5) 제안 푸시용 합성 문구: 발송일 +3일 15:30. {D+n} → "M월 D일", {W+n} → "(요)"
export const PUSH_TEMPLATE = "[합성의원] {D+3}{W+3} 오후 3시 30분 진료 예약이 확정되었습니다.";

export function renderPhrase(template: string, today: string): string {
  const base = Date.parse(`${today}T00:00:00Z`);
  return template.replace(/\{([DW])\+(\d+)\}/g, (_, t: string, n: string) => {
    const d = new Date(base + Number(n) * 86_400_000);
    return t === "D" ? `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일` : `(${WEEKDAYS_KO[d.getUTCDay()]})`;
  });
}

// 서버 최종 items.status 기대값. provider none 이면 게이트 없이 추출이 비어 empty 로 끝난다
export function expectedStatus(p: Phrase, provider: string): string {
  if (p.rules !== "pass") return `discarded:server:${p.rules}`;
  if (provider !== "none" && p.label !== "actionable") return `discarded:server:${p.label}`;
  return p.kinds.length === 0 ? "discarded:server:empty" : "extracted";
}
