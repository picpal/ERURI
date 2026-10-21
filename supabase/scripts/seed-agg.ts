// AGG-sim 시드(스펙 §15, 계획 G1): 테스트 사용자 23 에 /ingest 로 합성 문자(MESSAGES)를 넣고 배포 worker 처리(게이트·규칙 단계)가 끝날 때까지 기다린다.
// 실행 태그는 프로세스마다 같아야 정리된다 — --run <8자>(idempotency_key `MESSAGES:test:<run8>:agg-…`, 규칙 값 `r<run8>-<n>`).
// 사용자 세션은 매직링크 토큰으로 받는다 — testUser 는 비밀번호를 바꿔 시뮬레이터 앱의 refresh token 을 끊는다(0.16.0 G1 교훈).
// 출력은 건수·상태·시각 분포만(본문·키워드·규칙 값 없음). 합성 문구만(AGENTS.md §7).
// 사용: deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/seed-agg.ts --phase <p> --run <run8> [--since <ISO>]
//   before    합성PAY 문자 4건(규칙 전 — ① 게이트 결과 기록)       after  합성PAY 문자 6건(규칙 뒤 — ③ gate_label 'rule')
//   bank      합성은행 문자 2건(⑨ 규칙 전)                         notice  합성은행 안내형 3건(⑨ 보강 — Jev 폐기 → 복구 경로)                         bank-rule  /chat/rule add keyword 합성은행 — 응답을 버린다(⑨ 응답 유실)
//   rules20   있는 규칙을 세어 합계 20개까지만 r<run8>-<n> 로 채운다(⑧, K25)
//   status    이 실행 항목의 상태·gate_label·청크·gate_feedback 건수   cleanup  이 실행 항목·그 잡·사용자 23 규칙(·--since 뒤 감사·진단·알림 잡)
import { createClient } from "npm:@supabase/supabase-js@2";
import { SERVER_AUTH } from "../functions/_shared/crypto.ts";
import { service as sb, testUserId } from "../tests/_testenv.ts";

const arg = (k: string) => { const i = Deno.args.indexOf(k); return i >= 0 ? Deno.args[i + 1] : undefined; };
const phase = arg("--phase"), run8 = arg("--run"), since = arg("--since");
if (!phase || !run8 || !/^[0-9a-f]{8}$/.test(run8)) { console.error("usage: --phase <p> --run <8 hex>"); Deno.exit(2); }
const RUN = `test:${run8}`;
const BASE = Deno.env.get("SUPABASE_URL")!, ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const USER = await testUserId(23);
const KEY = `MESSAGES:${RUN}:agg-`;

// 서울 이번 주 월요일 + (요일 색인, 시, 분). 시드 시각은 월요일~지금 안이어야 한다 — 밖이면 멈춘다(④⑤ 기대값이 어긋나므로)
const nowSeoul = new Date(Date.now() + 9 * 3600_000);
const monday = new Date(Date.UTC(nowSeoul.getUTCFullYear(), nowSeoul.getUTCMonth(), nowSeoul.getUTCDate() - ((nowSeoul.getUTCDay() + 6) % 7)));
const at = (d: number, h: number, m: number) => new Date(monday.getTime() + d * 86400_000 + (h * 60 + m) * 60_000 - 9 * 3600_000);
type Seed = { tag: string; d: number; h: number; m: number; sender: string; text: string };
const pay = (tag: string, d: number, h: number, m: number, n: number): Seed =>
  ({ tag, d, h, m, sender: "합성PAY", text: `[합성PAY] 결제 타임아웃 발생 — 합성 가맹점 승인 지연 ${n}회차, 잠시 후 다시 시도해 주세요` });
const bank = (tag: string, d: number, h: number, m: number, n: number): Seed =>
  ({ tag, d, h, m, sender: "합성은행", text: `[합성은행] 입출금 알림 — 합성 계좌 출금 ${n}0,000원, 잔액 확인은 앱에서` });
// 합성PAY 10건 분포: 시 14→4·10→2·21→2·08→1·01→1(최다 14시 4건), 날 월 4·화 0·수 5·목 1
const PLAN: Record<string, Seed[]> = {
  before: [pay("b1", 0, 14, 10, 1), pay("b2", 2, 14, 20, 2), pay("b3", 2, 10, 5, 3), pay("b4", 3, 1, 15, 4)],
  after: [pay("a1", 0, 10, 30, 5), pay("a2", 0, 14, 40, 6), pay("a3", 2, 14, 50, 7), pay("a4", 2, 21, 0, 8), pay("a5", 0, 21, 10, 9), pay("a6", 2, 8, 0, 10)],
  bank: [bank("k1", 1, 9, 0, 1), bank("k2", 1, 11, 30, 2)],
  // ①·⑨ 시드가 모두 Jev 통과(D = D′ = 0)면 [함께 저장]·rule_saved 경로가 돌지 않는다 — Jev 가 폐기할 안내형 합성은행 문자(⑨ 보강, 규칙 추가 전에)
  notice: [1, 2, 3].map((n): Seed => ({ tag: `n${n}`, d: 1, h: 12 + n, m: 0, sender: "합성은행",
    text: `[합성은행] 10월 혜택 안내 — 합성 카드 이용 시 포인트 ${n}배 적립 이벤트 진행 중, 자세한 내용은 앱에서 확인하세요. 수신거부 080-000-000${n}` })),
};

// 비밀번호를 바꾸지 않는 사용자 세션(매직링크 해시 토큰 → verifyOtp)
async function userSession() {
  const { data: u } = await sb.auth.admin.getUserById(USER);
  const { data, error } = await sb.auth.admin.generateLink({ type: "magiclink", email: u.user!.email! });
  if (error) throw new Error("generateLink " + error.code);
  const c = createClient(BASE, ANON, SERVER_AUTH);
  const v = await c.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: "magiclink" });
  if (v.error || !v.data.session) throw new Error("verifyOtp " + v.error?.code);
  return v.data.session.access_token;
}
async function call(token: string, path: string, body: unknown) {
  const r = await fetch(`${BASE}/functions/v1/${path}`, { method: "POST", headers: { authorization: `Bearer ${token}`, apikey: ANON, "content-type": "application/json" },
    body: JSON.stringify(body) });
  await r.body?.cancel();
  return r.status;
}
const count = <T>(xs: T[], f: (x: T) => string) => xs.reduce((o, x) => (o[f(x)] = (o[f(x)] ?? 0) + 1, o), {} as Record<string, number>);
type Row = { id: string; idempotency_key: string; status: string; gate_label: string | null; gate_confidence: number | null };
async function runItems(group?: string): Promise<Row[]> {
  const { data, error } = await sb.from("items").select("id, idempotency_key, status, gate_label, gate_confidence").eq("user_id", USER)
    .like("idempotency_key", `${KEY}${group ?? ""}%`);
  if (error) throw new Error("items " + error.code);
  return data as Row[];
}
const groupOf = (r: Row) => ({ b: "before", a: "after", k: "bank", n: "notice" } as Record<string, string>)[r.idempotency_key.slice(KEY.length)[0]] ?? "?";
async function chunked(ids: string[]) {
  if (!ids.length) return 0;
  const { data } = await sb.from("item_chunks").select("item_id").eq("user_id", USER).in("item_id", ids);
  return new Set((data ?? []).map((r) => r.item_id as string)).size;
}
const settled = (s: string) => s !== "queued" && s !== "processing";

if (phase === "before" || phase === "after" || phase === "bank" || phase === "notice") {
  const seeds = PLAN[phase], now = Date.now();
  for (const s of seeds) {
    const t = at(s.d, s.h, s.m).getTime();
    if (t > now || t < monday.getTime() - 9 * 3600_000) { console.error(`seed ${s.tag} outside this week..now — rerun later`); Deno.exit(2); }
  }
  const token = await userSession();
  const ing: number[] = [];
  for (const s of seeds) {
    ing.push(await call(token, "ingest", { id: `${RUN}:agg-${s.tag}`, source: "MESSAGES", sender: s.sender, title: null, text: s.text,
      capturedAt: at(s.d, s.h, s.m).toISOString(), deviceFilter: "rules" }));
  }
  const t0 = Date.now();
  let items: Row[] = [];
  const prefix = { before: "b", after: "a", bank: "k", notice: "n" }[phase];
  while (Date.now() - t0 < 600_000) {
    items = await runItems(prefix);
    if (items.length === seeds.length && items.every((i) => settled(i.status))) break;
    await new Promise((r) => setTimeout(r, 10_000));
  }
  console.log(JSON.stringify({ phase, ingest: ing, wait_s: Math.round((Date.now() - t0) / 1000), n: items.length, status: count(items, (i) => i.status),
    gate_label: count(items, (i) => i.gate_label ?? "null"), confidence_null: items.filter((i) => i.gate_confidence === null).length,
    hours: count(seeds, (s) => String(s.h).padStart(2, "0")), days: count(seeds, (s) => at(s.d, 12, 0).toISOString().slice(0, 10)) }));
} else if (phase === "bank-rule") {
  const token = await userSession();
  const http = await call(token, "chat/rule", { op: "add", kind: "keyword", value: "합성은행" });   // 응답 본문은 읽지 않고 버린다(응답 유실 재현)
  console.log(JSON.stringify({ phase, http }));
} else if (phase === "rules20") {
  const { count: have, error } = await sb.from("save_rules").select("id", { count: "exact", head: true }).eq("user_id", USER);
  if (error) throw new Error("save_rules " + error.code);
  const add = Math.max(0, 20 - (have ?? 0));
  const rows = Array.from({ length: add }, (_, i) => ({ user_id: USER, kind: "keyword", value: `r${run8}-${i + 1}` }));
  if (rows.length) { const ins = await sb.from("save_rules").insert(rows); if (ins.error) throw new Error("insert " + ins.error.code); }
  const { count: total } = await sb.from("save_rules").select("id", { count: "exact", head: true }).eq("user_id", USER);
  console.log(JSON.stringify({ phase, had: have, added: add, total }));
} else if (phase === "status") {
  const items = await runItems();
  const ids = items.map((i) => i.id);
  const { data: fb } = ids.length ? await sb.from("gate_feedback").select("item_id, verdict").eq("user_id", USER).in("item_id", ids) : { data: [] };
  const verdict = new Map((fb ?? []).map((f) => [f.item_id as string, f.verdict as string]));
  const { count: rules } = await sb.from("save_rules").select("id", { count: "exact", head: true }).eq("user_id", USER);
  const out: Record<string, unknown> = { phase, rules };
  for (const g of ["before", "after", "bank", "notice"]) {
    const xs = items.filter((i) => groupOf(i) === g);
    if (!xs.length) continue;
    out[g] = { n: xs.length, status: count(xs, (i) => i.status), gate_label: count(xs, (i) => i.gate_label ?? "null"),
      feedback: count(xs, (i) => verdict.get(i.id) ?? "none"), chunked: await chunked(xs.map((i) => i.id)) };
  }
  console.log(JSON.stringify(out));
} else if (phase === "cleanup") {
  const errs: string[] = [];
  const note = (what: string, r: { error: { code?: string } | null }) => { if (r.error) errs.push(`${what}:${r.error.code ?? "?"}`); };
  const ids = (await runItems()).map((i) => i.id);
  for (const id of ids) note("jobs", await sb.from("jobs").delete().eq("user_id", USER).eq("payload->>item_id", id));   // 복구·처리 잡 lease 는 item:<id>(K24)
  if (ids.length) {
    note("audit_log", await sb.from("audit_log").delete().eq("user_id", USER).in("target", ids));
    note("items", await sb.from("items").delete().eq("user_id", USER).in("id", ids));                                   // facts·청크·gate_feedback cascade
  }
  note("save_rules", await sb.from("save_rules").delete().eq("user_id", USER));                                       // 사용자 23 = 이 게이트 전용
  if (since) {
    note("audit_since", await sb.from("audit_log").delete().eq("user_id", USER).gte("at", since));
    note("traces_since", await sb.from("device_traces").delete().eq("user_id", USER).gte("received_at", since));
    note("notify_since", await sb.from("jobs").delete().eq("user_id", USER).eq("kind", "notify").gte("created_at", since));
  }
  const left = (await runItems()).length;
  let jobsLeft = 0;
  for (const id of ids) jobsLeft += (await sb.from("jobs").select("id", { count: "exact", head: true }).eq("user_id", USER).eq("payload->>item_id", id)).count ?? 0;
  const rulesLeft = (await sb.from("save_rules").select("id", { count: "exact", head: true }).eq("user_id", USER)).count;
  console.log(JSON.stringify({ phase, items: ids.length, left_items: left, left_jobs: jobsLeft, left_rules: rulesLeft, errors: errs }));
  if (errs.length || left || jobsLeft || rulesLeft) Deno.exitCode = 1;
} else {
  console.error("unknown phase"); Deno.exit(2);
}
