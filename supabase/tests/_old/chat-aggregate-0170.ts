// 0.17.0 사본(162281f) — 구 chat 조합 테스트 전용, 고치지 않는다
import type { SaveRule } from "../../functions/_shared/save-rules.ts";
import { WEEKDAYS_KO } from "../../functions/_shared/time.ts";

// 집계 질문(스펙 §9 "채팅 저장 규칙·집계 질문", 0.17.0). 모델 칸 재검증 ①~⑥ → aggregate_items(0035)가 센 숫자로 칸·문장·꼬리 줄을 서버가 만든다.
// 조건을 버려 넓히지 않는다 — 모델이 낸 조건 중 하나라도 무효면 bad_condition. 순수 함수 — 로그·DB 없음(키워드·발신자는 호출부가 로그에 넣지 않는다)
// filters.ts 를 import 하지 않는다(filters.ts 가 AGG_SOURCES 를 가져가 순환이 된다, PF-F18) — 달력 검사는 filters.ts day() 와 같은 규칙을 여기 둔다
export const AGG_SOURCES = ["MESSAGES", "NOTIFICATION", "GMAIL", "SHARE"] as const;
export type AggSource = typeof AGG_SOURCES[number];
export type AggBucket = "hour" | "day" | "weekday";
export type AggRaw = { keywords?: unknown; sender?: unknown; sources?: unknown; from?: unknown; to?: unknown; bucket?: unknown };
export type AggConditions = { keywords: string[]; sender: string | null; sources: AggSource[]; from: string; to: string; bucket: AggBucket; defaulted: boolean; clamped: boolean };
export type Revalidated = { kind: "ok"; conditions: AggConditions; inherited: boolean } | { kind: "bad_condition" } | { kind: "question" };
export type BucketCount = { key: string; count: number };
export type Bucket = { key: string; label: string; count: number };
export type AggregateResult = { status: "ok" | "bad_condition" | "failed"; conditions: AggConditions | null; total: number; buckets: Bucket[]; top: Bucket[];
  sentence: string; notes: string[] };

export const AGG_TEXT = { failed: "집계하지 못했어요 — 잠시 뒤 다시 물어봐 주세요", bad: "조건을 정확히 알아듣지 못했어요 — 키워드·기간을 다시 말해 주세요",
  savedOnly: "저장된 메시지만 셌어요." } as const;

const BUCKETS: readonly AggBucket[] = ["hour", "day", "weekday"];
const KEYWORDS_MAX = 3, TEXT_MIN = 2, TEXT_MAX = 30, DEFAULT_DAYS = 7, MAX_DAYS = 90;
const DAY_MS = 86_400_000;
const WEEK_ISO = ["월", "화", "수", "목", "금", "토", "일"];   // aggregate_items weekday 키 "1"~"7" = ISO(1 = 월요일)

// 달력에 있는 YYYY-MM-DD 만(filters.ts day() 와 같은 규칙 — 2026-02-30 은 Postgres date 변환 오류)
function calendarDay(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
const plusDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
const chars = (s: string) => [...s].length;   // 코드 포인트(K8 — SQL char_length 와 같은 수)
const inRange = (s: string) => chars(s) >= TEXT_MIN && chars(s) <= TEXT_MAX;

// ① 문자열만, 앞뒤 공백 제거·빈 값 제거·대소문자 무시 중복 제거(먼저 나온 것을 남긴다). 배열이 아니면 빈 목록
function keywordList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>(), out: string[] = [];
  for (const k of v) {
    if (typeof k !== "string") continue;
    const t = k.trim(), low = t.toLowerCase();
    if (t && !seen.has(low)) { seen.add(low); out.push(t); }
  }
  return out;
}
// ③ 네 값 밖·중복을 뺀다. 빈 배열 = 전체 출처
const sourceList = (v: unknown): AggSource[] =>
  Array.isArray(v) ? [...new Set(v.filter((s): s is AggSource => (AGG_SOURCES as readonly unknown[]).includes(s)))] : [];
const isEmpty = (v: unknown) => v === null || v === undefined;

type Period = { from: string; to: string; defaulted: boolean; clamped: boolean };
// ④ 형식 밖·달력에 없는 날은 bad(null 반환). 둘 다 없으면 최근 7일, 한쪽만이면 채우고, 거꾸로면 맞바꾸고, 미래 to 는 오늘, 미래 from 은 기본값, 90일 넘으면 to 를 두고 줄인다
function period(from: unknown, to: unknown, today: string): Period | null {
  for (const d of [from, to]) if (!isEmpty(d) && (typeof d !== "string" || !calendarDay(d))) return null;
  const dflt: Period = { from: plusDays(today, -(DEFAULT_DAYS - 1)), to: today, defaulted: true, clamped: false };
  let f = from as string | null | undefined, t = to as string | null | undefined;
  if (isEmpty(f) && isEmpty(t)) return dflt;
  if (isEmpty(t)) t = today;
  if (isEmpty(f)) f = plusDays(t!, -(DEFAULT_DAYS - 1));
  if (f! > t!) [f, t] = [t, f];
  if (t! > today) t = today;
  if (f! > today) return dflt;
  if (daysBetween(f!, t!) + 1 > MAX_DAYS) return { from: plusDays(t!, -(MAX_DAYS - 1)), to: t!, defaulted: false, clamped: true };
  return { from: f!, to: t!, defaulted: false, clamped: false };
}

// 재검증 ①~⑥. previous = 서버가 재검증한 직전 집계 조건(aggregate_context) — 지금 글이 말하지 않아 빈 칸만 채우고(⑥) 그 뒤 ①~⑤
export function revalidateAggregate(raw: AggRaw | null, today: string, previous: AggConditions | null): Revalidated {
  const r = raw ?? {};
  let inherited = false;
  let keywords = keywordList(r.keywords);
  if (keywords.length === 0) {
    if (!previous) return { kind: "question" };                               // 키워드 없는 집계는 범위 밖 → 질문 흐름
    keywords = previous.keywords; inherited = true;
  }
  if (keywords.length > KEYWORDS_MAX || !keywords.every(inRange)) return { kind: "bad_condition" };

  // ② null(·빈 글)은 조건 없음. 값이 있으면 2~30자 — 아니면 bad(null 로 바꿔 모든 발신자를 세지 않는다)
  let sender: string | null;
  if (isEmpty(r.sender) || (typeof r.sender === "string" && r.sender.trim() === "")) {
    sender = previous?.sender ?? null;
    if (previous && previous.sender !== null) inherited = true;
  } else if (typeof r.sender === "string" && inRange(r.sender.trim())) sender = r.sender.trim();
  else return { kind: "bad_condition" };

  let sources = sourceList(r.sources);
  if (sources.length === 0 && previous && previous.sources.length > 0) { sources = previous.sources; inherited = true; }

  let p: Period | null;
  if (previous && isEmpty(r.from) && isEmpty(r.to)) {
    // 기간을 이어받으면 직전 defaulted·clamped 를 그대로(K11) — ④가 그 기간을 바꿨을 때만 새 플래그
    inherited = true;
    const q = period(previous.from, previous.to, today);
    p = q && q.from === previous.from && q.to === previous.to ? { ...q, defaulted: previous.defaulted, clamped: previous.clamped } : q;
  } else p = period(r.from, r.to, today);
  if (!p) return { kind: "bad_condition" };

  let bucket: AggBucket;
  if (isEmpty(r.bucket) && previous) { bucket = previous.bucket; inherited = true; }
  else bucket = BUCKETS.includes(r.bucket as AggBucket) ? r.bucket as AggBucket : "day";   // ⑤ 세 값 밖은 day(세는 수는 같다)

  return { kind: "ok", inherited, conditions: { keywords, sender, sources, from: p.from, to: p.to, bucket, defaulted: p.defaulted, clamped: p.clamped } };
}

// 8칸 모양 — 키 누락도 틀림(PF-F6: sender 는 null 이라도 키가 있어야 한다)
function shaped(v: unknown): v is AggConditions {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  const strings = (a: unknown) => Array.isArray(a) && a.every((x) => typeof x === "string");
  return strings(o.keywords) && "sender" in o && (o.sender === null || typeof o.sender === "string") && strings(o.sources)
    && typeof o.from === "string" && typeof o.to === "string" && typeof o.bucket === "string"
    && typeof o.defaulted === "boolean" && typeof o.clamped === "boolean";
}
const SEARCH_KEYS = ["keywords", "sender", "sources", "from", "to", "bucket"] as const;
const sameSearch = (a: AggConditions, b: AggConditions) => SEARCH_KEYS.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));

// 요청 aggregate_context(K11): 없으면 null. 모양이 틀리거나 검색 조건 6칸이 그 재검증(①~⑤)과 다르면 "bad"(→ 400 bad_context).
// 이력 플래그 defaulted·clamped 는 비교하지 않고 입력 값을 그대로 돌려준다(확정 기간을 다시 검증하면 둘 다 false 가 된다)
export function parseAggregateContext(v: unknown, today: string): AggConditions | null | "bad" {
  if (v === undefined || v === null) return null;
  if (!shaped(v)) return "bad";
  const r = revalidateAggregate({ keywords: v.keywords, sender: v.sender, sources: v.sources, from: v.from, to: v.to, bucket: v.bucket }, today, null);
  if (r.kind !== "ok" || !sameSearch(r.conditions, v)) return "bad";
  return { ...r.conditions, defaulted: v.defaulted, clamped: v.clamped };
}

// 목록 칸 키(K20): hour "00"~"23", weekday "1"~"7", day = from~to 안의 달력 날짜
function bucketKeyOk(c: AggConditions, k: string): boolean {
  if (c.bucket === "hour") return /^\d{2}$/.test(k) && Number(k) <= 23;
  if (c.bucket === "weekday") return /^[1-7]$/.test(k);
  return calendarDay(k) && k >= c.from && k <= c.to;
}

// POST /chat/aggregate: 응답 conditions 를 다시 ①~⑤(이어받기 ⑥ 없음). 키워드 0개·bad_condition·모양 틀림·칸 키가 그 종류 밖이면 null(→ 400 bad_request)
export function revalidateListRequest(conditions: unknown, bucketKey: unknown, today: string): { conditions: AggConditions; bucketKey: string } | null {
  if (!shaped(conditions) || typeof bucketKey !== "string") return null;
  const r = revalidateAggregate(conditions, today, null);
  if (r.kind !== "ok" || !bucketKeyOk(r.conditions, bucketKey)) return null;
  return { conditions: r.conditions, bucketKey };
}

// 칸 라벨: 14시 · 10/15(목)(서울 달력 요일) · 월
export function bucketLabel(bucket: AggBucket, key: string): string {
  if (bucket === "hour") return `${Number(key)}시`;
  if (bucket === "weekday") return WEEK_ISO[Number(key) - 1] ?? key;
  const [, m, d] = key.split("-").map(Number);
  return `${m}/${d}(${WEEKDAYS_KO[new Date(`${key}T00:00:00Z`).getUTCDay()]})`;
}

// 0건 칸까지 전체 칸: hour 24, day 기간의 모든 날(≤ 90), weekday 7(월~일). 칸 밖 키는 버린다
export function fillBuckets(c: AggConditions, counts: BucketCount[]): Bucket[] {
  const keys = c.bucket === "hour" ? Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"))
    : c.bucket === "weekday" ? ["1", "2", "3", "4", "5", "6", "7"]
    : Array.from({ length: daysBetween(c.from, c.to) + 1 }, (_, i) => plusDays(c.from, i));
  const n = new Map(counts.map((x) => [x.key, x.count]));
  return keys.map((key) => ({ key, label: bucketLabel(c.bucket, key), count: n.get(key) ?? 0 }));
}

// 0건 제외, 건수 내림차순 · 같으면 칸 순서(sort 는 안정 정렬), 최대 3
export const topBuckets = (b: Bucket[]): Bucket[] => b.filter((x) => x.count > 0).sort((a, z) => z.count - a.count).slice(0, 3);

// 마지막 글자의 받침으로 조사를 고른다(한글 음절이 아니면 받침 없음 쪽)
function josa(word: string, withFinal: string, without: string): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return code >= 0 && code <= 11171 && code % 28 !== 0 ? withFinal : without;
}
// 출처 말: MESSAGES 하나 "문자", GMAIL "메일", NOTIFICATION "알림", SHARE "공유한 글", 없거나 여럿 "메시지"
const SOURCE_WORD: Record<AggSource, string> = { MESSAGES: "문자", GMAIL: "메일", NOTIFICATION: "알림", SHARE: "공유한 글" };
const sourceWord = (c: AggConditions) => c.sources.length === 1 ? SOURCE_WORD[c.sources[0]] : "메시지";

// 기간: 기본값 "최근 7일", 아니면 M/D–M/D(하루면 M/D), 올해가 아니면 앞에 "YYYY. "(양 끝 해가 다르면 각각), 90일로 줄였으면 "(최대 90일)"
function periodText(c: AggConditions, today: string): string {
  if (c.defaulted) return "최근 7일";
  const year = today.slice(0, 4), fy = c.from.slice(0, 4), ty = c.to.slice(0, 4);
  const md = (d: string) => { const [, m, day] = d.split("-").map(Number); return `${m}/${day}`; };
  const text = c.from === c.to ? `${fy === year ? "" : `${fy}. `}${md(c.from)}`
    : fy === ty ? `${fy === year ? "" : `${fy}. `}${md(c.from)}–${md(c.to)}`
    : `${fy}. ${md(c.from)}–${ty}. ${md(c.to)}`;
  return c.clamped ? `${text}(최대 90일)` : text;
}

// 최다 칸 주어: hour "14시대", day "10/15(목)", weekday "수요일". 조사 — day 는 괄호 뒤라 스펙 문구 그대로 "가", 나머지는 받침으로
const leaderWord = (c: AggConditions, b: Bucket) => c.bucket === "hour" ? `${b.label}대` : c.bucket === "weekday" ? `${b.label}요일` : b.label;
const subject = (c: AggConditions, word: string) => c.bucket === "day" ? "가" : josa(word, "이", "가");

// 서버 템플릿 문장(LLM 이 숫자를 쓰지 않는다): {기간} '{키워드}' {발신자}{출처 말} {total}건 — {최다}
export function aggregateSentence(c: AggConditions, total: number, buckets: Bucket[], today: string): string {
  const head = `${periodText(c, today)} '${c.keywords.join("·")}' ${c.sender ? `${c.sender}에서 온 ` : ""}${sourceWord(c)}`;
  const max = Math.max(0, ...buckets.map((b) => b.count));
  if (total === 0 || max === 0) return `${head}${josa(sourceWord(c), "은", "는")} 0건이에요`;
  const leaders = buckets.filter((b) => b.count === max);
  if (leaders.length === 1) {
    const w = leaderWord(c, leaders[0]);
    return `${head} ${total}건 — ${w}${subject(c, w)} ${max}건으로 가장 많았어요`;
  }
  if (leaders.length <= 3) {
    const w = leaders.map((b) => leaderWord(c, b)).join("·");
    return `${head} ${total}건 — ${w}${subject(c, w)} 각각 ${max}건으로 가장 많았어요`;
  }
  return `${head} ${total}건 — ${leaders.length}개 칸이 각각 ${max}건으로 가장 많았어요`;
}

// 꼬리 줄(이 순서): ① 항상 "저장된 메시지만 셌어요." ② 0건이고 그 키워드의 keyword 규칙이 없고(소문자 비교) 발신자 조건이 있으면 그 sender 규칙도 없을 때 안내
export function aggregateNotes(c: AggConditions, total: number, rules: SaveRule[]): string[] {
  const notes: string[] = [AGG_TEXT.savedOnly];
  if (total > 0) return notes;
  const kws = new Set(c.keywords.map((k) => k.toLowerCase()));
  const has = (kind: SaveRule["kind"], v: string) => rules.some((r) => r.kind === kind && r.value.toLowerCase() === v);
  const keywordRule = [...kws].some((k) => has("keyword", k));
  const senderRule = c.sender !== null && has("sender", c.sender.toLowerCase());
  if (!keywordRule && !senderRule) {
    const w = sourceWord(c);
    notes.push(`알림으로 분류돼 저장되지 않았을 수 있어요 — '앞으로 ${c.keywords[0]} ${w}${josa(w, "은", "는")} 저장해'라고 하면 다음부터 셀 수 있어요.`);
  }
  return notes;
}

export function okAggregate(c: AggConditions, counts: BucketCount[], total: number, rules: SaveRule[], today: string): AggregateResult {
  const buckets = fillBuckets(c, counts);
  return { status: "ok", conditions: c, total, buckets, top: topBuckets(buckets), sentence: aggregateSentence(c, total, buckets, today),
    notes: aggregateNotes(c, total, rules) };
}

// ok 가 아니면 숫자 칸은 0·빈 배열, 문장은 오류 문구. failed 는 재검증 뒤 조건을, bad_condition 은 null(무효 조건을 보이지 않고 다시 말하게)
export const failedAggregate = (c: AggConditions): AggregateResult =>
  ({ status: "failed", conditions: c, total: 0, buckets: [], top: [], sentence: AGG_TEXT.failed, notes: [] });
export const BAD_CONDITION: AggregateResult = Object.freeze({ status: "bad_condition", conditions: null, total: 0, buckets: [], top: [], sentence: AGG_TEXT.bad,
  notes: [] }) as AggregateResult;
