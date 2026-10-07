import { type GmailMessage, header } from "./gmail.ts";
import { maskSensitive } from "./rules.ts";
import { parseFrom } from "./unsub.ts";

// 메일 메타 → 앱에 보이는 줄(발신자·제목·날짜). 메일 정리 미리보기 표본(sampleOf, 0.14.0에서 옮김)과 메일 요약 후보(candidateMeta)가 같이 쓴다.
// 응답으로만 앱에 간다 — 저장·로그 없음(스펙 §12)

// UTF-16 단위로 자르되 끝에 짝 없는 서로게이트를 남기지 않는다 — iOS JSON 디코더가 응답 전체를 거절한다(0.14.0 M5 리뷰 Important 1).
// 메일 요약 본문 자르기(mail-body.ts clipText, S2)도 이 함수를 쓴다(따로 만들지 않는다)
export function clip16(s: string, n: number): string {
  const t = s.slice(0, n);
  return /[\uD800-\uDBFF]$/.test(t) ? t.slice(0, -1) : t;
}
function dateOf(m: GmailMessage): string {
  const t = Number(m.internalDate || NaN);                             // 비거나 숫자가 아니면 날짜만 비운다 — 표본 하나로 응답이 500 이 되지 않게
  return Number.isFinite(t) ? new Date(t).toISOString() : "";
}
function fromOf(m: GmailMessage): string {
  const f = parseFrom(header(m, "From"));
  return clip16(f?.name || f?.address || "", 60);
}
export function sampleOf(m: GmailMessage) {
  return { from: fromOf(m), subject: clip16(header(m, "Subject") ?? "", 100), date: dateOf(m) };
}
// 메일 요약 후보·otp·no_body 응답(스펙 §7 "검색", 계획 D6): 제목은 maskSensitive(카드·계좌·승인번호) 뒤 100자 — 가린 뒤 자른다
export function candidateMeta(m: GmailMessage) {
  return { from: fromOf(m), subject: clip16(maskSensitive(header(m, "Subject") ?? ""), 100), date: dateOf(m) };
}
