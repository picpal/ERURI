// DIGEST-eval 러너(스펙 §15, DP22). DB·사용자·예산 RPC 없음(OpenAI 키만).
// --part quality --runs 2: 회차마다 합성 10통을 가짜 Gmail·가짜 예산·진짜 summarizeDigest(gpt-6-luna)로 digest() 한 번 → 줄마다 형식(원출력·후처리 뒤)·gpt-6-sol 채점·gradeRun.
// --part count --runs 3: 사례마다 chat 필터(extractFilters + 가드, 0.19.0 앱 intents)를 불러 countMatches.
// stdout = 사례 id·회차·불리언·숫자·토큰·원. 줄 글·채점 근거는 supabase/eval/digest.local.json(gitignore)에만
// 사용: deno run --allow-net --allow-env --allow-read --allow-write=supabase/eval --env-file=supabase/.env supabase/scripts/eval-digest.ts --part quality --runs 2
//       deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/eval-digest.ts --part count --runs 3
import { costKrw, type HoldReservation, type LedgerLine, responseUsage, type TokenUsage } from "../functions/_shared/budget.ts";
import { parseStructured, type RawResponse } from "../functions/_shared/extract.ts";
import type { GmailMessage } from "../functions/_shared/gmail.ts";
import { signToken } from "../functions/_shared/mail-token.ts";
import { openai } from "../functions/_shared/openai.ts";
import { ACTION_INTENTS, aggModeFor, extractFilters } from "../functions/chat/filters.ts";
import type { MailReadDeps } from "../functions/mail-read/common.ts";
import { DIGEST_LIMITS, type DigestLine, digest } from "../functions/mail-read/digest.ts";
import { parseDigest, SUMMARY_MODEL, summarizeDigest } from "../functions/mail-read/summary.ts";
import { type CountFile, countMatches, type DigestFile, formatOk, gradeRun, hasMarker, type Judge, judgeRequest, validateDigestCases } from "./_digest-eval.ts";
import { parseRuns } from "./_intent-eval.ts";
import { buildMessage } from "./_summary-eval.ts";

const runs = parseRuns(Deno.args);
if (runs === null) { console.log(JSON.stringify({ error: "runs" })); Deno.exit(1); }
const pi = Deno.args.indexOf("--part"), part = pi >= 0 ? Deno.args[pi + 1] : undefined;
if (part !== "quality" && part !== "count") { console.log(JSON.stringify({ error: "part", want: "--part quality|count" })); Deno.exit(1); }
const p50 = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0; };

// deno-lint-ignore no-explicit-any
type Create = (b: any, o: { timeout: number; maxRetries: number; signal?: AbortSignal }) => Promise<unknown>;
// deno-lint-ignore no-explicit-any
const create: Create = (b, o) => openai.responses.create(b as any, o);

if (part === "count") {
  const file = JSON.parse(await Deno.readTextFile(new URL("../eval/digest-count-cases.json", import.meta.url))) as CountFile;
  const APP_INTENTS = new Set<string>(ACTION_INTENTS);                   // 0.19.0 앱 intents = 0.17.0 과 같다(PF-20)
  const misses: Record<string, unknown>[] = [];
  let total = 0;
  for (let run = 1; run <= runs; run++) {
    for (const c of file.cases) {
      let mr = null, intent = "error";
      try {
        const r = await extractFilters(c.text, file.today, c.context, true, undefined, null, aggModeFor(c.text, APP_INTENTS, null));
        mr = r.mail_read ?? null; intent = r.intent ?? "question";
      } catch { /* 호출 실패는 불일치 */ }
      const ok = countMatches(c, mr);
      total++;
      const ctxText = c.context.map((t) => `${t.question}\n${t.answer}`).join("\n");
      const got = mr === null ? null : { count: mr.count, latest: mr.latest, sender_is_context: mr.sender !== null && ctxText.includes(mr.sender),
        sender_ok: (mr.sender ?? null) === c.expect.sender, target_in_message: mr.target_in_message,
        empty_targets: mr.sender === null && mr.subject_words.length === 0 && mr.received_from === null && mr.received_to === null && !mr.latest };
      console.log(JSON.stringify({ run, id: c.id, ok, intent, got }));
      if (!ok) misses.push({ id: c.id, run, intent, got });
    }
  }
  console.log(JSON.stringify({ part: "count", pass: misses.length === 0, total, matched: total - misses.length, misses }));
  Deno.exit(0);
}

// ── ① 품질 ──
const file = JSON.parse(await Deno.readTextFile(new URL("../eval/digest-cases.json", import.meta.url))) as DigestFile;
const problems = validateDigestCases(file);
if (problems.length) { console.log(JSON.stringify({ error: "cases", problems })); Deno.exit(1); }
const USER = "11111111-1111-4111-8111-111111111111", CONN = "22222222-2222-4222-8222-222222222222";
const key = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign", "verify"]);   // 이 실행만의 토큰 키
const gid = (i: number) => `19a0${String(i + 1).padStart(12, "0")}`;     // 합성 Gmail id
const msgs = new Map<string, GmailMessage>(file.cases.map((c, i) => [gid(i), buildMessage(c)] as const).map(([g, m]) => [g, { ...m, id: g }]));
const byFrom = new Map(file.cases.map((c) => [c.message.from, c.id]));
type Call = { raw: string[] | null; raw_error: string | null; usage: TokenUsage | null; ms: number };

const review: Record<string, unknown>[] = [];
const rowsOut: { id: string; run: number; preserved: boolean; contradicted: number; forbidden: number; unsupported: number; mixed: boolean; format: boolean;
  marker: boolean; judged: boolean; sig: string }[] = [];
const runKrw: number[] = [], callMs: number[] = [];
let judgeKrw = 0, injectionOk = true;
for (let run = 1; run <= runs; run++) {
  const calls = new Map<string, Call>();
  const ledger: LedgerLine[] = [];
  const d: MailReadDeps = {
    enabled: () => true, authUser: async () => USER, connection: async () => ({ connection_id: CONN, status: "active" }), accessToken: async () => "at",
    takeUnits: async () => true, tokenKey: async () => key,
    budget: { reserve: async () => ({ level: "ok", month: "2026-10-01" }), settle: async () => {}, acquire: async () => 1, release: async () => {}, now: () => new Date() },
    holds: { reserve: async (): Promise<HoldReservation> => ({ level: "ok", month: "2026-10-01" }),
      settle: async (_u, _h, lines) => { ledger.push(...lines); return "settled"; } },
    summarize: () => { throw new Error("detail not used"); },
    // 진짜 짧은 모드 — create 를 감싸 후처리 전 원출력(parseDigest)과 지연을 따로 모은다
    summarizeDigest: (i, onUsage, signal, t) => {
      const id = byFrom.get(i.from) ?? "?", call: Call = { raw: null, raw_error: null, usage: null, ms: 0 };
      calls.set(id, call);
      const t0 = Date.now();
      return summarizeDigest(i, (u) => { call.usage = u; onUsage(u); }, signal, t, async (b, o) => {
        const r = await create(b, o);
        call.ms = Date.now() - t0;
        try { call.raw = parseDigest(r as RawResponse); } catch (e) { call.raw_error = e instanceof Error ? e.message : "error"; }
        return r;
      });
    },
    audit: async () => {}, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: () => Date.now(), today: () => file.today,
    api: () => ({ list: () => { throw new Error("no list"); }, headers: () => { throw new Error("no headers"); },
      full: async (id) => { const m = msgs.get(id); if (!m) throw new Error("no mail"); return structuredClone(m); } }),
  };
  const e = Math.floor(Date.now() / 1000) + 600;
  const tokens = await Promise.all(file.cases.map((_, i) => signToken(key, { u: USER, c: CONN, m: gid(i), e })));
  const t0 = Date.now();
  const res = await digest({ user: USER, request_id: `eval-${run}`, t0 }, { tokens }, d, DIGEST_LIMITS);
  const digestMs = Date.now() - t0;
  const body = await res.json() as { results?: DigestLine[]; error?: string };
  if (!body.results) { console.log(JSON.stringify({ run, error: body.error ?? res.status })); Deno.exit(1); }
  runKrw.push(ledger.reduce((a, l) => a + l.krw, 0));
  for (const [i, c] of file.cases.entries()) {
    const ln = body.results[i], call = calls.get(c.id);
    if (call?.ms) callMs.push(call.ms);
    const lines = ln.lines;
    const fmtRaw = formatOk(call?.raw ?? []), fmt = formatOk(lines);
    const format = ln.status === "ok" && fmt.lines_ok && fmt.chars_ok && fmt.korean_ok;
    if (c.kind === "injection" && ([...lines, ...(call?.raw ?? [])].some((s) => c.forbidden_facts.some((f) => s.includes(f))) || ln.status !== "ok")) injectionOk = false;
    let j: Judge | null = null, judgeErr: string | null = null;
    if (ln.status === "ok" && lines.length) {
      try {
        const r = await openai.responses.create(judgeRequest(c, lines) as never) as unknown as RawResponse & Parameters<typeof responseUsage>[0];
        const u = responseUsage(r);
        if (u) judgeKrw += costKrw("gpt-6-sol", u);
        j = parseStructured(r) as Judge;
        if (j.facts.length !== c.must_facts.length || j.forbidden.length !== c.forbidden_facts.length) { judgeErr = "count_mismatch"; }
      } catch (err) { judgeErr = err instanceof Error ? err.message.slice(0, 80) : "error"; j = null; }
    }
    const others = file.cases.filter((o) => o.id !== c.id).map((o) => o.marker);
    const g = j ? gradeRun(j, lines, c.marker, others)
      : { preserved: false, contradicted: 0, forbidden: 0, unsupported: 0, mixed: others.some((m) => hasMarker(lines.join("\n"), m)) };   // 채점 실패 = 보존 아님
    const marker = hasMarker(lines.join("\n"), c.marker);              // 보조 지표: 자기 표식 포함
    const sig = j ? JSON.stringify([j.facts.map((f) => f.verdict), j.forbidden.map((f) => f.verdict), j.unsupported.length]) : "none";
    rowsOut.push({ id: c.id, run, ...g, format, marker, judged: j !== null && judgeErr === null, sig });
    review.push({ id: c.id, run, kind: c.kind, status: ln.status, code: ln.code, raw: call?.raw ?? null, raw_error: call?.raw_error ?? null, lines, format_raw: fmtRaw, format: fmt,
      judge: j, judge_error: judgeErr, grade: g, marker });
    console.log(JSON.stringify({ run, id: c.id, status: ln.status, n: lines.length, raw_n: call?.raw?.length ?? null, format, format_raw: fmtRaw.lines_ok && fmtRaw.chars_ok && fmtRaw.korean_ok,
      ...g, marker, judged: j !== null && judgeErr === null, in: call?.usage?.input ?? 0, out: call?.usage?.output ?? 0, ms: call?.ms ?? 0 }));
  }
  console.log(JSON.stringify({ run, digest_ms: digestMs, krw: Math.round(runKrw.at(-1)! * 100) / 100 }));
}
await Deno.writeTextFile(new URL("../eval/digest.local.json", import.meta.url), JSON.stringify(review, null, 1));
const n = rowsOut.length, cnt = (f: (r: typeof rowsOut[number]) => boolean) => rowsOut.filter(f).length;
const sum = (k: "contradicted" | "forbidden" | "unsupported") => rowsOut.reduce((a, r) => a + r[k], 0);
const dis = new Set<string>();
for (const r of rowsOut) {
  if (!r.judged || r.contradicted || r.forbidden || r.unsupported || r.mixed || r.marker !== r.preserved) dis.add(r.id);
}
for (const c of file.cases) if (new Set(rowsOut.filter((r) => r.id === c.id).map((r) => r.sig)).size > 1) dis.add(c.id);
const preserved = cnt((r) => r.preserved), format = cnt((r) => r.format), mixed = cnt((r) => r.mixed);
const out = { part: "quality", preserved: `${preserved}/${n}`, contradicted: sum("contradicted"), forbidden: sum("forbidden"), unsupported: sum("unsupported"), mixed,
  format: `${format}/${n}`, injection_ok: injectionOk, krw_per_10: Math.round((runKrw.reduce((a, b) => a + b, 0) / runKrw.length) * 100) / 100, p50_ms: p50(callMs),
  judge_krw: Math.round(judgeKrw * 100) / 100, marker_hits: `${cnt((r) => r.marker)}/${n}`, model: SUMMARY_MODEL,
  auto_pass: preserved >= Math.ceil(n * 0.9) && sum("contradicted") === 0 && sum("forbidden") === 0 && sum("unsupported") === 0 && mixed === 0 && format === n && injectionOk,
  disagreements: [...dis].sort() };
console.log(JSON.stringify(out));
