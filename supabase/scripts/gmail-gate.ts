// M1-③ 게이트(스펙 §15 ③, PoC-6 흡수): Gmail 연결 상태·웹훅→sync 지연·합성 메일 저장 지연·백필/공백 누락을 id·수치로만 본다.
// 본문·제목·주소는 출력하지 않는다(합성 메일 제목 접두는 조회 조건에만 쓴다). gap 은 Gmail 메시지를 메모리에서 서버 규칙으로만 다시 판정한다
// (출력·저장 없음, AGENTS.md §7). 판정 로직은 _gmail-gate.ts(순수, tests/gmail-gate.test.ts)
// 사용: deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/gmail-gate.ts <명령> [옵션] [--user <uuid>] [--connection <uuid>]
//   status                                        연결·T0(expires_at − 7일)·watch·백필 레인 분류·최근 연결 백필 ID 수·GMAIL 항목 상태별 수·사용량·재인증 푸시
//   latency --since <ISO>                         via:webhook gmail-sync 의 적재→첫 클레임(초). 연결 창 sync 는 표본 밖, 재시도는 표본(플래그), 끝 줄 요약에 gate
//   mails --prefix <합성 제목 접두> --since <ISO>    합성 메일 항목의 Gmail 수신(occurred_at)→저장(captured_at) 초
//   gap --after <ISO> --before <ISO> [--q <검색어>] 그 구간 Gmail 목록 id(-category:promotions [검색어]) ↔ items
//   gap --from-jobs [--since <ISO>]               이 연결의 백필 gmail-fetch 잡 payload.ids 전체 ↔ items (저장·규칙 폐기·gone·누락)
import { createClient } from "npm:@supabase/supabase-js@2";
import { SERVER_AUTH } from "../functions/_shared/crypto.ts";
import { gmailApi, GmailHttpError, gmailToItem, refreshAccessToken } from "../functions/_shared/gmail.ts";
import {
  backlog, type BacklogRow, bursts, busyAt, classify, connectSyncIds, judgeIds, type LaneRow, mailDelays, summarize, type SyncRow, t0Of, type Verdict,
} from "./_gmail-gate.ts";

type Rows<T> = PromiseLike<{ data: T[] | null; error: { code?: string } | null }>;
type Count = PromiseLike<{ count: number | null; error: { code?: string } | null }>;

const GAP_PAUSE_MS = 240;                 // gmail-fetch 와 같은 간격(분당 ≤ 250건 = 5,000 units)
const RETRY_429_MS = 5_000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// PostgREST 는 요청당 최대 1000행이다. 백필이 1,000건을 넘으면 잘리므로 끝까지 페이지로 읽는다
async function all<T>(page: (from: number, to: number) => Rows<T>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error("query " + (error.code ?? "error"));
    out.push(...(data ?? []));
    if ((data ?? []).length < 1000) return out;
  }
}
async function count(q: Count): Promise<number> {
  const { count: n, error } = await q;
  if (error) throw new Error("count " + (error.code ?? "error"));
  return n ?? 0;
}

export async function run(argv: string[], out: (line: string) => void,
  env: (k: string) => string | undefined = (k) => Deno.env.get(k)): Promise<number> {
  const cmd = argv[0];
  const arg = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const iso = (k: string) => { const t = Date.parse(arg(k) ?? ""); return Number.isFinite(t) ? new Date(t).toISOString() : undefined; };
  const userArg = arg("--user") ?? env("ERURI_USER_ID");
  if (!userArg) { console.error("ERURI_USER_ID 없음"); return 2; }
  const user: string = userArg;
  const sb = createClient(env("SUPABASE_URL")!, env("SUPABASE_SERVICE_ROLE_KEY")!, SERVER_AUTH);
  let cq = sb.from("connections").select("id, status, expires_at, created_at").eq("user_id", user).eq("provider", "gmail");
  const connArg = arg("--connection");
  if (connArg) cq = cq.eq("id", connArg);
  const { data: conns, error: connErr } = await cq.order("created_at", { ascending: false }).limit(1);
  if (connErr) throw new Error("connections " + (connErr.code ?? "error"));
  const conn = conns?.[0];
  if (!conn) { out(JSON.stringify({ error: "no_connection" })); return 1; }

  // 이 연결의 gmail-connect 가 넣은 백필 gmail-fetch 잡(적재 시각·ID). ID 값은 gap 판정에만 쓰고 출력하지 않는다
  const backfillFetches = async (since?: string) => (await all<{ created_at: string; payload: { ids?: string[] } }>((a, b) => {
    let q = sb.from("jobs").select("created_at, payload").eq("user_id", user).eq("kind", "gmail-fetch")
      .eq("payload->>backfill", "true").eq("payload->>connection_id", conn.id);
    if (since) q = q.gte("created_at", since);
    return q.order("created_at").range(a, b);
  })).map((r) => ({ created_at: r.created_at, ids: r.payload.ids ?? [] }));

  if (cmd === "status") {
    // 게이트 입력(③c2 L = last_success_at, ③c1 reauth_pushes)이라 조회 오류를 null 로 삼키지 않는다
    const { data: st, error: stErr } = await sb.from("sync_states").select("last_success_at, watch_expires_at").eq("connection_id", conn.id).eq("user_id", user).maybeSingle();
    if (stErr) throw new Error("sync_states " + (stErr.code ?? "error"));
    const lane = await all<BacklogRow>((a, b) => sb.from("jobs").select("kind, status, not_before, last_error, leased_until").eq("user_id", user)
      .eq("priority", 40).in("status", ["queued", "running", "dead"]).range(a, b));
    const fetches = await backfillFetches();
    const bs = bursts(fetches.map((f) => f.created_at));
    const latest = bs.at(-1);
    const idsLatest = latest ? fetches.filter((f) => Date.parse(f.created_at) >= latest.start).reduce((n, f) => n + f.ids.length, 0) : 0;
    const gmailDead = await count(sb.from("jobs").select("id", { count: "exact", head: true }).eq("user_id", user).like("kind", "gmail-%").eq("status", "dead"));
    const items = await all<{ status: string }>((a, b) => sb.from("items").select("status").eq("user_id", user).eq("source", "GMAIL").range(a, b));
    const byStatus: Record<string, number> = {};
    for (const r of items) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    const { data: usage, error: usageErr } = await sb.from("usage_counters").select("month, extract_tokens, backfill_tokens, reserved_krw, backfill_reserved_krw")
      .eq("user_id", user).order("month");
    if (usageErr) throw new Error("usage_counters " + (usageErr.code ?? "error"));
    const { data: pushes, error: pushErr } = await sb.from("reauth_pushes").select("reason, sent_at").eq("user_id", user).order("sent_at");
    if (pushErr) throw new Error("reauth_pushes " + (pushErr.code ?? "error"));
    out(JSON.stringify({
      connection: { id: conn.id, status: conn.status, created_at: conn.created_at, expires_at: conn.expires_at, t0: t0Of(conn.expires_at) },
      sync: st, backfill: backlog(lane, Date.now()), backfill_bursts: bs.length, backfill_ids_latest: idsLatest,
      gmail_jobs_dead: gmailDead, gmail_items: byStatus, usage, reauth_pushes: pushes,
    }, null, 1));
    return 0;
  }

  if (cmd === "latency") {
    const since = iso("--since");
    if (!since) { console.error("--since <ISO>"); return 2; }
    const syncs = await all<Omit<SyncRow, "busy">>((a, b) => sb.from("jobs").select("id, created_at, claimed_at, status, attempts, last_error")
      .eq("user_id", user).eq("kind", "gmail-sync").eq("payload->>via", "webhook").eq("payload->>connection_id", conn.id)
      .gte("created_at", since).order("created_at").range(a, b));
    // 레인 점유 판정용: since 뒤에 움직였거나 아직 끝나지 않은 백필 레인 잡
    const lane = await all<LaneRow>((a, b) => sb.from("jobs").select("created_at, claimed_at, status, updated_at").eq("user_id", user)
      .eq("priority", 40).or(`updated_at.gte.${since},status.in.(queued,running)`).order("created_at").range(a, b));
    const rows: SyncRow[] = syncs.map((s) => ({ ...s, busy: busyAt(lane, Date.parse(s.created_at)) }));
    const samples = classify(rows, connectSyncIds(rows, (await backfillFetches(since)).map((f) => f.created_at)));
    for (const s of samples) {
      out([s.id, s.created_at, s.latency_s ?? "-", `busy=${s.busy}`, s.kind + (s.retried ? "+retried" : ""), s.status].join("\t"));
    }
    out(JSON.stringify(summarize(samples)));
    return 0;
  }

  if (cmd === "mails") {
    const prefix = arg("--prefix"), since = iso("--since");
    if (!prefix || !since) { console.error("--prefix <합성 제목 접두> --since <ISO>"); return 2; }
    const rows = await all<{ id: string; occurred_at: string; captured_at: string }>((a, b) => sb.from("items").select("id, occurred_at, captured_at")
      .eq("user_id", user).eq("source", "GMAIL").like("title", `${prefix}%`).gte("occurred_at", since).range(a, b));
    const d = mailDelays(rows);
    for (const m of d) out([m.id, m.delay_s].join("\t"));
    const xs = d.map((m) => m.delay_s);
    out(JSON.stringify({ mails: d.length, max_delay_s: xs.length ? Math.max(...xs) : null,
      avg_delay_s: xs.length ? Math.round(xs.reduce((a, x) => a + x, 0) / xs.length * 10) / 10 : null }));
    return 0;
  }

  if (cmd === "gap") {
    const fromJobs = argv.includes("--from-jobs");
    const after = iso("--after"), before = iso("--before"), extra = arg("--q");
    if (!fromJobs && (!after || !before)) { console.error("--after <ISO> --before <ISO> [--q <검색어>] | --from-jobs [--since <ISO>]"); return 2; }
    const { data: rt, error } = await sb.rpc("gmail_get_refresh_token", { p_user: user, p_connection: conn.id });
    if (error || !rt) { out(JSON.stringify({ error: "no_refresh_token" })); return 1; }
    const api = gmailApi(await refreshAccessToken(rt as string));
    const ids: string[] = [];
    if (fromJobs) for (const f of await backfillFetches(iso("--since"))) ids.push(...f.ids);
    else {
      const q = `after:${Math.floor(Date.parse(after!) / 1000)} before:${Math.floor(Date.parse(before!) / 1000)} -category:promotions${extra ? " " + extra : ""}`;
      let page: string | undefined;
      do {
        const p = await api.listMessageIds(q, page);
        ids.push(...(p.messages ?? []).map((m) => m.id));
        page = p.nextPageToken;
      } while (page);
    }
    const uniq = [...new Set(ids)];
    const have = new Set<string>();
    for (let i = 0; i < uniq.length; i += 100) {
      const { data, error: e } = await sb.from("items").select("idempotency_key").eq("user_id", user)
        .in("idempotency_key", uniq.slice(i, i + 100).map((x) => "gmail:" + x));
      if (e) throw new Error("items " + (e.code ?? "error"));       // 조회 실패를 "저장 안 됨"이나 "누락 없음"으로 보지 않는다
      for (const r of data ?? []) have.add(r.idempotency_key.slice("gmail:".length));
    }
    const get = async (id: string): Promise<Verdict> => {
      for (let tries = 0; ; tries++) {
        try { return gmailToItem(await api.getMessage(id)); }
        catch (e) {
          if (e instanceof GmailHttpError && e.status === 404) return "gone";                         // 목록 뒤 삭제·초안 교체
          if (e instanceof GmailHttpError && e.status === 429 && tries === 0) { await sleep(RETRY_429_MS); continue; }
          throw e;
        }
      }
    };
    const r = await judgeIds(uniq, have, get, () => sleep(GAP_PAUSE_MS));
    out(JSON.stringify(r));
    return r.missing.length ? 1 : 0;
  }

  console.error("usage: gmail-gate.ts <status|latency|mails|gap>");
  return 2;
}

if (import.meta.main) Deno.exit(await run(Deno.args, (line) => console.log(line)));
