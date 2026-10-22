// 본문 건수(스펙 §7 "본문 건수"): 추출 응답의 metrics 원값을 label·count·시각으로 검증한다.
// 정규화는 worker가 부른다(extract-text는 이 모듈을 import하지 않는다). OpenAI 클라이언트를 끌어오지 않게 time.ts만 쓴다
import { receivedDay } from "./time.ts";

export const METRICS_MAX = 10;
const LABEL_MAX = 30;
const COUNT_MAX = 100000;
const AHEAD_MS = 24 * 3600_000; // 본문 시각이 받은 시각보다 이만큼 넘게 뒤면 받은 시각
const BEHIND_MS = 168 * 3600_000; // 이만큼 넘게 앞이면 받은 시각

// at = UTC ISO(toISOString, K3). at_body = 본문 시각을 썼는지
export type Metric = { label: string; count: number; at: string; at_body: boolean };

const DT = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(Z|[+-]\d{2}:\d{2})?$/;
const T = /^(\d{2}):(\d{2})(Z|[+-]\d{2}:\d{2})?$/;
const SEOUL = "+09:00";

// 'Z' 또는 ±HH:MM(HH 00~14, MM 00·30·45) → 분. 그 밖이면 null
function offsetMinutes(off: string): number | null {
  if (off === "Z") return 0;
  const h = Number(off.slice(1, 3)), m = Number(off.slice(4, 6));
  if (h > 14 || ![0, 30, 45].includes(m)) return null;
  return (off[0] === "-" ? -1 : 1) * (h * 60 + m);
}

// 달력에 있는 날·시 00~23·분 00~59일 때만 epoch ms
function toMs(y: number, mo: number, d: number, h: number, mi: number, off: string): number | null {
  const offMin = offsetMinutes(off);
  if (offMin === null || h > 23 || mi > 59) return null;
  const day = new Date(Date.UTC(y, mo - 1, d));
  if (day.getUTCFullYear() !== y || day.getUTCMonth() !== mo - 1 || day.getUTCDate() !== d) return null;
  return Date.UTC(y, mo - 1, d, h, mi) - offMin * 60_000;
}

const LATE_MS = 10 * 60_000; // 시각만: 받은 날에 붙인 값이 받은 시각보다 이만큼 넘게 뒤면 전날(Ruling N8-time)
const DAY_MS = 24 * 3600_000;

// 본문 시작 시각(K4). 날짜+시각은 오프셋이 없으면 서울, 시각만은 받은 시각 이전의 가장 최근 그 시각(받은 서울 날짜, 받은 시각 + 10분보다 뒤면
// 하루 앞 — 자정 직후 받은 "23:50"은 전날, 오프셋은 +09:00만). 형식 밖이면 null
function bodyMs(start: unknown, occurredAt: string, received: number): number | null {
  if (typeof start !== "string") return null;
  const dt = DT.exec(start);
  if (dt) return toMs(+dt[1], +dt[2], +dt[3], +dt[4], +dt[5], dt[6] ?? SEOUL);
  const t = T.exec(start);
  if (!t || (t[3] !== undefined && t[3] !== SEOUL)) return null;
  const [y, mo, d] = receivedDay(occurredAt).split("-").map(Number);
  const ms = toMs(y, mo, d, +t[1], +t[2], SEOUL);
  return ms !== null && ms - received > LATE_MS ? ms - DAY_MS : ms;   // 서울은 서머타임이 없어 하루 = 24시간
}

// 근접 검증(Ruling N8-prox): count 숫자가 본문에 나오는 자리 바로 앞 20자(label 이 더 길면 그 길이 + 1) 안, 같은 구절(마지막 구분 기호 뒤)에
// label 이 있어야(공백·대소문자 무시) 받는다. 구절을 끊어야 "타임아웃 발생, 재시도 20건"의 {타임아웃, 20}을 버린다. 숫자는 천 단위 쉼표를 받고,
// 더 긴 숫자·소수의 일부는 아니다(앞이 숫자나 '숫자+쉼표/점'이면 아님 — 글자 뒤 쉼표 'timeout,6'은 경계가 아니다)
const NEAR = 20;
const NUM = /(?<!\d|\d[.,])\d{1,3}(?:,\d{3})+(?![\d]|[.,]\d)|(?<!\d|\d[.,])\d+(?![\d]|[.,]\d)/g;
const CLAUSE = /[,，.。;；/|·\n()（）\[\]{}]/;
// 괄호·표 표기(final-I1): 숫자 바로 앞 구분 기호 하나 — 공백만 사이에 둔 여는 괄호·표의 '|', 앞뒤 공백 없이 붙은 쉼표 — 는 건너뛰고,
// 그 앞의 짝 맞는 괄호 묶음(줄바꿈 없이)을 지운 뒤 창·구절을 본다. 짝 없는 여는 괄호는 경계로 남는다("(오늘 누적 14건)"의 14는 계속 버림)
const LEAD = /(?:[(\[（|][ \t]*|(?<=\S)[,，])$/;
const PAIRED = /\([^()\n]*\)|\[[^\[\]\n]*\]|（[^（）\n]*）/g;
const squash = (s: string) => s.replace(/\s/g, "").toLowerCase();
// 단위 검증(Ruling N8-unit): 숫자 바로 뒤(공백 건너뜀)가 건수 단위면 받고, 측정 단위(시간 길이·비율·금액·용량·배수)면 버리고, 아무것도 없거나
// 문장부호면 받는다. 공백 뒤의 다른 낱말("3 발생")은 단위 없음, 붙은 다른 글자("3x")는 버림. 서수(회차·번째)·기간(개월)은 건수가 아니다
const COUNT_UNIT = /^(?:건|회(?!차)|번(?!째)|개(?!월)|차례|명|件|times?(?![a-z]))/i;
const MEASURE = /^(?:초|분|시간|시|일|주|개월|달|년|원|달러|퍼센트|배|%|(?:ms|s|sec|secs|seconds?|min|mins|minutes?|h|hr|hrs|hours?|kb|mb|gb|tb|bytes?)(?![a-z]))/i;
function unitOk(after: string): boolean {
  const rest = after.replace(/^\s+/, "");
  if (rest === "" || COUNT_UNIT.test(rest)) return true;
  if (MEASURE.test(rest)) return false;
  return rest.length < after.length || /^[\p{P}\p{S}]/u.test(rest);
}

// 짝 맞는 괄호 묶음을 안쪽부터 지운다("(a(b)c)"도 한 번에 남지 않게)
function dropPaired(s: string): string {
  for (let prev = ""; prev !== s;) { prev = s; s = s.replace(PAIRED, ""); }
  return s;
}

// 출현 = 본문에 나온 숫자 하나: [위치, 값, 단위 통과, 근접 검증 글(구절)]
type Occurrence = { at: number; value: number; unit: boolean; clause: string };
function occurrences(text: string): Occurrence[] {
  return [...text.matchAll(NUM)].map((m) => {
    const prefix = dropPaired(text.slice(0, m.index).replace(LEAD, ""));
    return { at: m.index, value: Number(m[0].replace(/,/g, "")), unit: unitOk(text.slice(m.index + m[0].length)), clause: prefix };
  });
}
// 근접·단위 검증: 같은 출현에서 둘 다 만족해야 한다
function satisfies(o: Occurrence, label: string, count: number): boolean {
  if (o.value !== count || !o.unit) return false;
  const size = Math.max(NEAR, [...label].length + 1);
  const cut = [...o.clause].slice(-size).join("").split(CLAUSE).at(-1) ?? "";
  return squash(cut).includes(squash(label));
}

// 근접·단위 검증 글 = 모델이 본 가린 제목 + 가린 본문(N8-title — 제목에만 있는 건수도 받는다). 줄바꿈이 구절을 갈라 제목 낱말이 본문 숫자에 붙지 않는다.
// bodyStart = 본문이 시작하는 위치(그 앞은 제목 출현 — final-I3)
export type CheckText = { text: string; bodyStart: number };
export function metricCheckText(title: string | null | undefined, body: string): CheckText {
  const t = title && title.trim() !== "" ? title : null;
  if (t === null || body.trim() === "") return { text: t ?? body, bodyStart: t === null ? 0 : t.length + 1 };
  return { text: `${t}\n${body}`, bodyStart: t.length + 1 };
}

// check = metricCheckText(가린 제목, 가린 본문) — 근접 검증용. 글만 주면 모두 본문이다.
// 출현 일대일(final-I3): 받는 metric 마다 서로 다른 출현을 짝짓는다(모델 순서, 앞 metric 을 다른 출현으로 옮길 수 있으면 옮김 — 최대 짝짓기).
// 제목 출현은 그 metric 을 만족하는 본문 출현이 없을 때만 — 제목·본문에 되풀이된 같은 건수를 두 번 받지 않는다
export function normalizeMetrics(raw: unknown, occurredAt: string, check: string | CheckText): Metric[] {
  if (!Array.isArray(raw)) return [];
  const { text, bodyStart } = typeof check === "string" ? { text: check, bodyStart: 0 } : check;
  const parsed = Date.parse(occurredAt);
  const received = Number.isFinite(parsed) ? parsed : Date.now(); // receivedDay와 같은 대체
  const occ = occurrences(text);
  const owner = new Map<number, number>();                         // 출현 색인 → 짝지은 metric(out 색인)
  const cands: number[][] = [];                                    // out 색인 → 만족하는 출현 색인
  const take = (k: number, seen: Set<number>): boolean => {
    for (const o of cands[k]) {
      if (seen.has(o)) continue;
      seen.add(o);
      const cur = owner.get(o);
      if (cur === undefined || take(cur, seen)) { owner.set(o, k); return true; }
    }
    return false;
  };
  const out: Metric[] = [];
  for (const m of raw) {
    if (out.length >= METRICS_MAX) break;
    if (m === null || typeof m !== "object") continue;
    const { label: rawLabel, count, start } = m as Record<string, unknown>; // end는 보지 않는다(판정 ②)
    if (typeof rawLabel !== "string") continue;
    const label = rawLabel.trim().replace(/\s+/g, " ");
    const len = [...label].length;
    if (len < 1 || len > LABEL_MAX) continue;
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0 || count > COUNT_MAX) continue;
    const ok = occ.flatMap((o, i) => satisfies(o, label, count) ? [i] : []);
    const body = ok.filter((i) => occ[i].at >= bodyStart);
    cands[out.length] = body.length > 0 ? body : ok;
    if (!take(out.length, new Set())) continue;
    const bodyAt = bodyMs(start, occurredAt, received);
    const atBody = bodyAt !== null && bodyAt - received <= AHEAD_MS && received - bodyAt <= BEHIND_MS;
    out.push({ label, count, at: new Date(atBody ? bodyAt : received).toISOString(), at_body: atBody });
  }
  return out;
}
