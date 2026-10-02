import { encrypt, toBytea } from "./crypto.ts";
import {
  collectNewMessageIds, type GmailClient, gmailApi, GmailHttpError, type GmailMessage, gmailToItem, ReauthRequired, refreshAccessToken,
} from "./gmail.ts";
import type { Job } from "./job.ts";
import { hasListUnsub, isAdMail, unsubMeta } from "./unsub.ts";

// worker 잡 핸들러(gmail-sync·gmail-fetch·gmail-watch). 같은 연결의 잡은 lease_key 'gmail:<connection_id>'로 한 번에 하나만 돈다.
// service role 경로라 테이블을 직접 읽지 않고 user_id를 넘기는 저장 프로시저만 부른다(스펙 §12 통제 4)
export type RpcClient = {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string } | null }>;
};
export type GmailJobDeps = {
  refresh(refreshToken: string): Promise<string>;
  api(accessToken: string): GmailClient;
  encrypt(userId: string, plaintext: string): Promise<Uint8Array>;
  pause(ms: number): Promise<void>;
  topic(): string;
  onResync?(sb: RpcClient, user: string, conn: string, lastSuccessAt: string): Promise<void>;   // 재동기화 공백의 광고 헤더 스캔(스펙 §7)
  unsubBudgetMs?: number;                                                                     // recordUnsub 예산(기본 2000)
};
export const defaultGmailDeps: GmailJobDeps = {
  refresh: refreshAccessToken,
  api: gmailApi,
  encrypt,
  pause: (ms) => new Promise((r) => setTimeout(r, ms)),
  topic: () => Deno.env.get("GMAIL_PUBSUB_TOPIC")!,
  onResync: enqueueUnsubRescan,
};

const FETCH_BATCH = 50;
const FETCH_GAP_MS = 240;                 // 분당 250건 이하
// 스캔 fetch 간격: messages.get 20 units, 사용자당 분당 6,000 units(공식 사용 한도 문서). 스캔(backfill 레인)은 실시간 gmail-fetch
// (gmail:<연결> lease, 240ms → 분당 5,000 units)와 동시에 돌 수 있어 분당 한도의 절반(150건 = 3,000 units) 이하로 둔다(리뷰 M3)
const UNSUB_FETCH_GAP_MS = 400;
export const UNSUB_SCAN_Q = "newer_than:30d {category:promotions subject:광고} -in:drafts";
export const unsubScanQuery = (after?: number | null) => (after ? `after:${after} {category:promotions subject:광고} -in:drafts` : UNSUB_SCAN_Q);
const RECORD_BUDGET_MS = 2000;

// 광고 구독 해지(스펙 §7): 헤더 메타만 기록한다. 절대 throw하지 않는다 — gmail-fetch 를 실패시키면 거래 메일까지 유실된다(fail-open).
// RPC·암호화가 예산을 넘기면 기다리지 않는다(리뷰 H4 — catch 만으로는 멈춘 RPC 가 fetch 루프를 붙잡는다). 늦게 끝난 기록은 그대로 남는다(멱등)
export async function recordUnsub(sb: RpcClient, deps: Pick<GmailJobDeps, "encrypt" | "unsubBudgetMs">, user: string, conn: string, msg: GmailMessage,
                                  itemId: string | null): Promise<"recorded" | "skipped" | "error"> {
  let timer: number | undefined;
  try {
    const m = unsubMeta(msg);
    if (!m) return "skipped";
    const work = (async () => {
      const { error } = await sb.rpc("worker_record_unsub", {
        p_user: user, p_connection: conn, p_address: m.address, p_name: m.name, p_method: m.method,
        p_url_enc: m.url ? toBytea(await deps.encrypt(user, m.url)) : null,
        p_msg_key: "gmail:" + msg.id, p_occurred_at: new Date(Number(msg.internalDate)).toISOString(), p_item: itemId,
      });
      if (error) throw new Error("worker_record_unsub " + (error.code ?? "error"));
    })();
    work.catch(() => {});                                       // 예산을 넘긴 뒤 늦게 난 거부가 처리되지 않은 거부로 남지 않게
    const budget = new Promise<never>((_, rej) => {
      timer = setTimeout(() => rej(new Error("unsub_record_timeout")), deps.unsubBudgetMs ?? RECORD_BUDGET_MS);
    });
    await Promise.race([work, budget]);
    return "recorded";
  } catch {
    console.log(JSON.stringify({ connection_id: conn, code: "unsub_record_error" }));   // 코드만(주소·URL 없음)
    return "error";
  } finally {
    clearTimeout(timer);
  }
}

// 재동기화(history 404) 구간의 광고는 resync 목록(-category:promotions)에 없다 → 같은 구간만 헤더 스캔 잡(스펙 §7, 리뷰 N4).
// gmailSync 의 기본 onResync. 실패해도 sync 는 계속한다(throw 하지 않음)
export async function enqueueUnsubRescan(sb: RpcClient, user: string, conn: string, lastSuccessAt: string): Promise<void> {
  try {
    const lease = "backfill:" + user;
    await call(sb, "enqueue_job", { p_user: user, p_kind: "gmail-unsub-scan", p_lease_key: lease,
      p_payload: { connection_id: conn, backfill: true, lease_key: lease, after: Math.floor(new Date(lastSuccessAt).getTime() / 1000) - 86_400 } });
  } catch {
    console.log(JSON.stringify({ connection_id: conn, code: "unsub_rescan_enqueue_error" }));
  }
}

function ids(job: Job) {
  if (!job.user_id) throw new Error("gmail job without user_id");
  return { user: job.user_id, conn: String(job.payload.connection_id) };
}
async function call(sb: RpcClient, fn: string, args: Record<string, unknown>) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(fn + " " + (error.code ?? "error"));
  return data;
}
// refresh 실패(invalid_grant) → connections.status = reauth_required, 잡은 정상 종료해 재시도하지 않는다(스펙 §7)
async function accessToken(sb: RpcClient, deps: GmailJobDeps, user: string, conn: string): Promise<string | null> {
  const rt = await call(sb, "gmail_get_refresh_token", { p_user: user, p_connection: conn });
  if (!rt) return null;                   // 비활성 연결 또는 refresh token 없음
  try { return await deps.refresh(rt as string); }
  catch (e) {
    if (!(e instanceof ReauthRequired)) throw e;
    await call(sb, "gmail_update", { p_user: user, p_connection: conn, p_status: "reauth_required" });
    await call(sb, "gmail_enqueue_reauth", { p_user: user });   // 끊김 즉시 재인증 푸시(스펙 §7)
    console.log(JSON.stringify({ connection_id: conn, gmail: "reauth_required" }));
    return null;
  }
}

export async function gmailSync(sb: RpcClient, job: Job, deps = defaultGmailDeps): Promise<string> {
  const { user, conn } = ids(job);
  const token = await accessToken(sb, deps, user, conn);
  if (!token) return "skipped";
  const st = (await call(sb, "gmail_state", { p_user: user, p_connection: conn }) as { cursor: string; last_success_at: string }[])[0];
  if (!st) throw new Error("gmail_state not_found");
  const r = await collectNewMessageIds(deps.api(token), { cursor: st.cursor, lastSuccessAt: st.last_success_at });
  for (let i = 0; i < r.ids.length; i += FETCH_BATCH) {
    await call(sb, "enqueue_job", { p_user: user, p_kind: "gmail-fetch", p_lease_key: "gmail:" + conn,
      p_payload: { connection_id: conn, ids: r.ids.slice(i, i + FETCH_BATCH) } });
  }
  // 잡을 모두 넣은 뒤에 커서를 옮긴다. 그 사이 실패하면 다음 sync가 같은 구간을 다시 받고 idempotency_key가 중복을 막는다
  await call(sb, "gmail_update", { p_user: user, p_connection: conn, p_cursor: r.cursor });
  if (r.mode === "resync" && deps.onResync) await deps.onResync(sb, user, conn, st.last_success_at);   // 공백 구간 광고 스캔(스펙 §7)
  console.log(JSON.stringify({ connection_id: conn, mode: r.mode, new_ids: r.ids.length }));
  return r.mode;
}

export async function gmailFetch(sb: RpcClient, job: Job, deps = defaultGmailDeps): Promise<string> {
  const { user, conn } = ids(job);
  const token = await accessToken(sb, deps, user, conn);
  if (!token) return "skipped";
  const api = deps.api(token);
  let stored = 0, discarded = 0, gone = 0;
  let n = 0;
  // 잡 로컬 차단기(리뷰 U4-I1): 기록 예산은 호출당이라 RPC 가 계통적으로 멈추면 잡 지연이 예산 × 기록 수가 된다.
  // 첫 "error"(실패·타임아웃) 뒤 이 잡의 나머지 기록은 건너뛴다 → 잡당 추가 지연 ≈ 예산 1번. 빠진 기록은 일일 공백 스캔(0029)이 메운다
  let recordOff = false, recordSkipped = 0;
  const record = async (msg: GmailMessage, itemId: string | null) => {
    if (recordOff) { recordSkipped++; return; }
    if (await recordUnsub(sb, deps, user, conn, msg, itemId) === "error") recordOff = true;
  };
  for (const id of job.payload.ids as string[]) {
    if (n++ % 10 === 0) {
      const st = await call(sb, "gmail_state", { p_user: user, p_connection: conn }) as unknown[];
      if (st.length === 0) { console.log(JSON.stringify({ connection_id: conn, gmail_fetch: "connection_gone" })); return "connection_gone"; }
    }
    let msg: GmailMessage;
    try { msg = await api.getMessage(id); }
    catch (e) {
      if (!(e instanceof GmailHttpError && e.status === 404)) throw e;   // 429·5xx 는 잡 실패 → 백오프 재시도(0007)
      gone++;                                                           // 목록 뒤 삭제·초안 교체: 그 id 만 건너뛴다(§7)
      console.log(JSON.stringify({ connection_id: conn, code: "gmail_fetch_gone" }));   // 코드만(id 없음)
      await deps.pause(FETCH_GAP_MS);
      continue;
    }
    const it = gmailToItem(msg);                                   // /ingest와 같은 서버 규칙 필터
    if (it.kind === "discard") {
      discarded++;
      console.log(JSON.stringify({ connection_id: conn, gmail_discard: it.reason }));   // 사유 코드만
      if (it.reason === "promotion") await record(msg, null);   // 광고 헤더 메타(§7), fail-open
    } else {
      const itemId = await call(sb, "insert_item", {
        p_user: user, p_source: "GMAIL", p_idempotency_key: "gmail:" + id,
        p_sender: it.sender, p_title: it.title,                    // 제목은 카드·계좌 마스킹된 값
        p_content_enc: toBytea(await deps.encrypt(user, it.text)), // 평문 본문은 DB로 가지 않는다
        p_occurred_at: it.occurredAt,
        p_backfill: job.payload.backfill === true,   // 연결 시 90일 백필 → 백필 레인(§7)
      }) as string | null;
      stored++;
      // 게이트가 promo 로 판정하면 광고로 센다(unsub_list). 중복(null)은 첫 수신 때 기록됐다
      if (itemId && hasListUnsub(msg)) await record(msg, itemId);
    }
    await deps.pause(FETCH_GAP_MS);
  }
  if (recordSkipped) console.log(JSON.stringify({ connection_id: conn, code: "unsub_record_skipped", n: recordSkipped }));
  console.log(JSON.stringify({ connection_id: conn, gmail_fetch: { stored, discarded, gone } }));
  return "fetched";
}

// 광고 구독 해지 스캔(스펙 §7): 30일 1회(운영자가 gmail_enqueue_unsub_scan, ③c2 뒤), 일일 8일 공백(cron gmail_enqueue_unsub_gap, 0029) 또는 재동기화 공백(payload.after, enqueueUnsubRescan).
// 헤더만 읽는 자식 잡을 50개씩 넣는다. 백필 레인 lease 'backfill:<user>' — 실시간 sync 를 막지 않는다(리뷰 M3)
export async function gmailUnsubScan(sb: RpcClient, job: Job, deps = defaultGmailDeps): Promise<string> {
  const { user, conn } = ids(job);
  const token = await accessToken(sb, deps, user, conn);
  if (!token) return "skipped";
  const api = deps.api(token);
  const floor = Math.floor(Date.now() / 1000) - 30 * 86_400;     // 공백 스캔도 30일보다 오래된 구간은 읽지 않는다(화면이 30일)
  const after = typeof job.payload.after === "number" ? Math.max(job.payload.after, floor) : null;
  const want = new Map<string, string | null>();                 // gmail id → 게이트 promo 항목 id(없으면 라벨·표기로 다시 판정)
  let pageToken: string | undefined;
  do {
    const p = await api.listMessageIds(unsubScanQuery(after), pageToken);
    for (const m of p.messages ?? []) want.set(m.id, null);
    pageToken = p.nextPageToken;
  } while (pageToken);
  const listed = want.size;
  const since = new Date((after ?? floor) * 1000).toISOString();
  const targets = await call(sb, "unsub_scan_targets", { p_user: user, p_since: since }) as { gmail_id: string; item_id: string }[];
  for (const t of targets ?? []) want.set(t.gmail_id, t.item_id);
  const msgs = [...want].map(([id, item]) => ({ id, item }));
  const lease = typeof job.payload.lease_key === "string" ? job.payload.lease_key : "backfill:" + user;
  for (let i = 0; i < msgs.length; i += FETCH_BATCH) {
    await call(sb, "enqueue_job", { p_user: user, p_kind: "gmail-unsub-fetch", p_lease_key: lease,
      p_payload: { connection_id: conn, backfill: true, msgs: msgs.slice(i, i + FETCH_BATCH) } });
  }
  console.log(JSON.stringify({ connection_id: conn, unsub_scan: { listed, targets: targets?.length ?? 0, jobs: Math.ceil(msgs.length / FETCH_BATCH) } }));
  return "scanned";
}

export async function gmailUnsubFetch(sb: RpcClient, job: Job, deps = defaultGmailDeps): Promise<string> {
  const { user, conn } = ids(job);
  const token = await accessToken(sb, deps, user, conn);
  if (!token) return "skipped";
  const api = deps.api(token);
  let recorded = 0, skipped = 0, gone = 0;
  for (const { id, item } of job.payload.msgs as { id: string; item: string | null }[]) {
    let msg: GmailMessage;
    try { msg = await api.getMessageMeta(id); }
    catch (e) {
      if (!(e instanceof GmailHttpError && e.status === 404)) throw e;   // 429·5xx 는 잡 재시도(기록은 멱등)
      gone++;
      await deps.pause(UNSUB_FETCH_GAP_MS);
      continue;
    }
    if (item || isAdMail(msg)) {
      // 스캔은 기록 자체가 목적이라 실패를 done 으로 숨기지 않는다 — 잡 재시도(기록은 멱등, 리뷰 M2)
      const r = await recordUnsub(sb, deps, user, conn, msg, item);
      if (r === "error") throw new Error("unsub_record_error");
      if (r === "recorded") recorded++; else skipped++;
    } else skipped++;
    await deps.pause(UNSUB_FETCH_GAP_MS);
  }
  console.log(JSON.stringify({ connection_id: conn, unsub_fetch: { recorded, skipped, gone } }));
  return "fetched";
}

export async function gmailWatch(sb: RpcClient, job: Job, deps = defaultGmailDeps): Promise<string> {
  const { user, conn } = ids(job);
  const token = await accessToken(sb, deps, user, conn);
  if (!token) return "skipped";
  const w = await deps.api(token).watch(deps.topic());
  await call(sb, "gmail_update", { p_user: user, p_connection: conn,
    p_watch_expires_at: new Date(Number(w.expiration)).toISOString() });
  return "watched";
}
