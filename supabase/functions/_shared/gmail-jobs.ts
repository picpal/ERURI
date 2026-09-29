import { encrypt, toBytea } from "./crypto.ts";
import { collectNewMessageIds, type GmailClient, gmailApi, gmailToItem, ReauthRequired, refreshAccessToken } from "./gmail.ts";
import type { Job } from "./job.ts";

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
};
export const defaultGmailDeps: GmailJobDeps = {
  refresh: refreshAccessToken,
  api: gmailApi,
  encrypt,
  pause: (ms) => new Promise((r) => setTimeout(r, ms)),
  topic: () => Deno.env.get("GMAIL_PUBSUB_TOPIC")!,
};

const FETCH_BATCH = 50;
const FETCH_GAP_MS = 240;                 // 분당 250건 이하

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
  console.log(JSON.stringify({ connection_id: conn, mode: r.mode, new_ids: r.ids.length }));
  return r.mode;
}

export async function gmailFetch(sb: RpcClient, job: Job, deps = defaultGmailDeps): Promise<string> {
  const { user, conn } = ids(job);
  const token = await accessToken(sb, deps, user, conn);
  if (!token) return "skipped";
  const api = deps.api(token);
  let stored = 0, discarded = 0;
  for (const id of job.payload.ids as string[]) {
    const it = gmailToItem(await api.getMessage(id));             // /ingest와 같은 서버 규칙 필터
    if (it.kind === "discard") {
      discarded++;
      console.log(JSON.stringify({ connection_id: conn, gmail_discard: it.reason }));   // 사유 코드만
    } else {
      await call(sb, "insert_item", {
        p_user: user, p_source: "GMAIL", p_idempotency_key: "gmail:" + id,
        p_sender: it.sender, p_title: it.title,                    // 제목은 카드·계좌 마스킹된 값
        p_content_enc: toBytea(await deps.encrypt(user, it.text)), // 평문 본문은 DB로 가지 않는다
        p_occurred_at: it.occurredAt,
      });
      stored++;
    }
    await deps.pause(FETCH_GAP_MS);
  }
  console.log(JSON.stringify({ connection_id: conn, gmail_fetch: { stored, discarded } }));
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
