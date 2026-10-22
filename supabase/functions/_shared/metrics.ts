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

// 본문 시작 시각(K4). 날짜+시각은 오프셋이 없으면 서울, 시각만은 받은 서울 날짜의 그 시각(오프셋은 +09:00만). 형식 밖이면 null
function bodyMs(start: unknown, occurredAt: string): number | null {
  if (typeof start !== "string") return null;
  const dt = DT.exec(start);
  if (dt) return toMs(+dt[1], +dt[2], +dt[3], +dt[4], +dt[5], dt[6] ?? SEOUL);
  const t = T.exec(start);
  if (!t || (t[3] !== undefined && t[3] !== SEOUL)) return null;
  const [y, mo, d] = receivedDay(occurredAt).split("-").map(Number);
  return toMs(y, mo, d, +t[1], +t[2], SEOUL);
}

export function normalizeMetrics(raw: unknown, occurredAt: string): Metric[] {
  if (!Array.isArray(raw)) return [];
  const parsed = Date.parse(occurredAt);
  const received = Number.isFinite(parsed) ? parsed : Date.now(); // receivedDay와 같은 대체
  const out: Metric[] = [];
  for (const m of raw) {
    if (out.length >= METRICS_MAX) break;
    if (m === null || typeof m !== "object") continue;
    const { label: rawLabel, count, start } = m as Record<string, unknown>; // end는 보지 않는다(판정 ②)
    if (typeof rawLabel !== "string") continue;
    const label = rawLabel.trim().replace(/\s+/g, " ");
    const len = [...label].length;
    if (len < 1 || len > LABEL_MAX) continue;
    if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > COUNT_MAX) continue;
    const body = bodyMs(start, occurredAt);
    const atBody = body !== null && body - received <= AHEAD_MS && received - body <= BEHIND_MS;
    out.push({ label, count, at: new Date(atBody ? body : received).toISOString(), at_body: atBody });
  }
  return out;
}
