// LNK-eval 판정(계획 2026-10-02-link-event L7) — 네트워크 없는 순수 함수. eval-link.ts 와 link-eval.test.ts 가 쓴다
// events: null = 측정만(상태가 허용 목록 안이면 통과, 일정 수는 기록만 — 대화 캡처 사진의 게이트 격리 측정, U7)
export type Expect = { status: string[]; events: number | null; starts?: string[]; location?: string };
export type Case = { id: string; app_name?: string; title: string | null; text: string; expect: Expect };
export type Fact = { kind: string; ordinal: number; payload: { start?: string | null; location?: string | null } };

// 어긋난 항목 코드(빈 배열 = 일치). start: 기대가 날짜만(10자)이면 같아야 하고, 시각이면 그 앞부분(분까지)으로 시작해야 한다.
// location: 일정 중 하나의 장소가 기대 문자열을 포함. 일정이 아닌 fact(task·purchase)는 세지 않는다
export function judge(c: Case, status: string, facts: Fact[]): string[] {
  const miss: string[] = [];
  const events = facts.filter((f) => f.kind === "event").sort((a, b) => a.ordinal - b.ordinal);
  if (!c.expect.status.includes(status)) miss.push(`status:${status}`);
  if (c.expect.events !== null && events.length !== c.expect.events) miss.push(`events:${events.length}`);
  (c.expect.starts ?? []).forEach((s, k) => {
    const got = events[k]?.payload.start ?? "";
    if (s.length === 10 ? got !== s : !got.startsWith(s)) miss.push(`start${k}`);
  });
  const want = c.expect.location;
  if (want && !events.some((e) => (e.payload.location ?? "").includes(want))) miss.push("location");
  return miss;
}

// 본문 펼치기: {{GALLERY:n}} → "합성 갤러리 사진 설명 1번" … n줄(긴 청첩장 사례 — 앱 LinkText.compose 가 만드는 배치 그대로 쓴 사례에 넣는다)
export function expand(text: string): string {
  return text.replace(/\{\{GALLERY:(\d+)\}\}/g, (_m, n: string) =>
    Array.from({ length: Number(n) }, (_v, i) => `합성 갤러리 사진 설명 ${i + 1}번`).join("\n"));
}
