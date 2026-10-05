// 채팅 짧은 맥락 평가(스펙 §9 "대화 기록·짧은 맥락", 게이트 CTX-eval) — 합성 항목·질문만. 판정은 인용 태그·거절 여부, poison 은 합성 답 본문 부분 문자열(답 글을 출력하지 않는다)
export type Item = { tag: string; title: string; text: string };
export type Case = { id: string; first: string; firstCites: string; second: string; secondCites: string; avoid?: string; withContext: boolean; judged: boolean;
  contextAnswer?: string; mustContain?: string; mustNotContain?: string };   // contextAnswer: 첫 답 대신 맥락에 넣는 합성 답(poison)
export type Reply = { status: number; refused: boolean; cited: string[]; answer: string };   // cited = 인용 항목의 태그, answer 는 판정에만(출력 금지)
export type Row = { case: string; judged: boolean; miss: string[]; secondRefused?: boolean };

export const ITEMS: Item[] = [
  { tag: "dent", title: "합성치과 예약 안내", text: "합성치과 스케일링 예약이 10월 13일(화) 오후 3시로 확정되었습니다. 위치: 합성시 합성로 12 합성빌딩 2층" },
  { tag: "meet", title: "합성상사 분기 회의 안내", text: "합성상사 분기 회의가 10월 15일(목) 오전 10시에 열립니다. 장소: 합성타워 7층 대회의실" },
  { tag: "card", title: "합성카드 승인 알림", text: "합성카드 승인 합성마트 48,200원 10/02 18:31 일시불" },
  ...Array.from({ length: 6 }, (_, i) => ({ tag: `n${i}`, title: `합성잡담 ${i}`, text: `합성잡담 오늘 날씨 맑음 ${i}` })),
];

export const CASES: Case[] = [
  // 지시어(장소): 맥락 없이는 "거기"가 무엇인지 모른다
  { id: "place", first: "합성치과 예약 언제야?", firstCites: "dent", second: "거기 주소가 어디야?", secondCites: "dent", mustContain: "합성로 12", withContext: true, judged: true },
  // 생략(대상): "몇 시에 시작해?"의 대상은 앞 질문의 회의
  { id: "time", first: "합성상사 분기 회의 언제야?", firstCites: "meet", second: "몇 시에 시작해?", secondCites: "meet", withContext: true, judged: true },
  // 주제 바꾸기: 앞 대화가 새 질문을 끌고 가지 않는다
  { id: "switch", first: "합성치과 예약 언제야?", firstCites: "dent", second: "합성카드로 얼마 결제했어?", secondCites: "card", avoid: "dent", withContext: true, judged: true },
  // 이전 답에만 있는 거짓 사실(합성): 앞 답이 주소를 잘못 말했어도 이번 답은 문서(합성로 12)를 따른다
  { id: "poison", first: "합성치과 예약 언제야?", firstCites: "dent", contextAnswer: "합성치과 예약은 10월 13일 오후 3시예요. 위치는 합성대로 99예요.",
    second: "거기 주소가 어디야?", secondCites: "dent", mustContain: "합성로 12", mustNotContain: "99", withContext: true, judged: true },
  // 대조(측정만): 같은 두 번째 질문을 맥락 없이 — 거절되는 것이 정상
  { id: "control", first: "합성치과 예약 언제야?", firstCites: "dent", second: "거기 주소가 어디야?", secondCites: "dent", withContext: false, judged: false },
];

// 앱 ChatHistory.summary 와 같은 자르기(UTF-16, 서지 쌍을 가르지 않는다)
export function clip16(s: string, max: number): string {
  let out = "", n = 0;
  for (const ch of s) {
    if (n + ch.length > max) break;
    out += ch; n += ch.length;
  }
  return out;
}
export function contextOf(question: string, answer: string) { return [{ question, answer: clip16(answer, 400) }]; }

export function judge(c: Case, a: Reply, b: Reply): string[] {
  const miss: string[] = [];
  if (a.status !== 200 || a.refused || !a.cited.includes(c.firstCites)) miss.push("first");
  if (b.status !== 200 || b.refused || !b.cited.includes(c.secondCites)) miss.push("second");
  if (c.avoid && b.cited.includes(c.avoid)) miss.push("avoid");
  if (c.mustContain && !b.answer.includes(c.mustContain)) miss.push("fact");
  if (c.mustNotContain && b.answer.includes(c.mustNotContain)) miss.push("poison");
  return miss;
}

export function summarize(rows: Row[], runs: number) {
  const judged = rows.filter((r) => r.judged), control = rows.filter((r) => !r.judged);
  const failures = judged.filter((r) => r.miss.length > 0).length;
  return { gate: failures === 0 && judged.length > 0 ? "pass" : "fail", runs, cases: new Set(judged.map((r) => r.case)).size, failures,
    control: { runs: control.length, refused: control.filter((r) => r.secondRefused).length } };
}
