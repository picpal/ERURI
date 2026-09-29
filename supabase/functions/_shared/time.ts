// 서버 날짜 기준은 Asia/Seoul(스펙 §7 "일시는 ISO 8601 +09:00"). 여러 모듈이 같은 함수를 쓴다(OpenAI 클라이언트를 끌어오지 않게 분리)
export const WEEKDAYS_KO = ["일", "월", "화", "수", "목", "금", "토"] as const;

export function seoulToday(now = new Date()): string {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

// 텍스트 항목의 상대 날짜("내일", "목요일") 기준일 = 받은 시각(occurred_at)의 서울 날짜.
// 오프라인 큐·지연 처리로 처리 시각이 늦어도 날짜가 밀리지 않는다. 해석할 수 없으면 지금
export function receivedDay(occurredAt: string, now = new Date()): string {
  const ms = Date.parse(occurredAt);
  return seoulToday(Number.isFinite(ms) ? new Date(ms) : now);
}
