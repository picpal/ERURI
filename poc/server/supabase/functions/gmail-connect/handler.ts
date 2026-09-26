import type { RpcClient } from "../_shared/gmail-jobs.ts";
import type { GmailClient, TokenResponse } from "../_shared/gmail.ts";

// iOS → POST /functions/v1/gmail-connect  (Authorization: Bearer <Supabase 사용자 access token>, body { code: serverAuthCode })
// 코드 교환(Web 클라이언트) → profile → watch → gmail_save_connection(refresh token은 vault) → watch 만료 기록
// → 90일 백필 gmail-fetch 잡 → gmail-sync 잡. 응답·로그에 토큰을 담지 않는다
export type ConnectDeps = {
  authUser(token: string): Promise<string | null>;
  exchange(code: string): Promise<TokenResponse>;
  api(accessToken: string): Pick<GmailClient, "profile" | "watch" | "listMessageIds">;
  rpc: RpcClient;
  topic(): string;
};

const BACKFILL_QUERY = "newer_than:90d -category:promotions";
const err = (status: number, code: string) => Response.json({ error: code }, { status });

export async function handleConnect(req: Request, deps: ConnectDeps): Promise<Response> {
  const token = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const user = token ? await deps.authUser(token) : null;
  if (!user) return new Response(null, { status: 401 });
  let body: { code?: unknown };
  try { body = await req.json(); } catch { return err(400, "bad_json"); }
  if (typeof body.code !== "string" || body.code.length === 0) return err(400, "missing_code");

  let t: TokenResponse;
  try { t = await deps.exchange(body.code); } catch (e) {
    console.log(JSON.stringify({ gmail_connect: "exchange_failed", detail: e instanceof Error ? e.message.slice(0, 60) : "" }));
    return err(502, "token_exchange_failed");
  }
  const api = deps.api(t.access_token);
  const p = await api.profile();
  const w = await api.watch(deps.topic());
  const saved = await deps.rpc.rpc("gmail_save_connection", { p_user: user, p_account_ref: p.emailAddress,
    p_refresh_token: t.refresh_token ?? null, p_history_id: w.historyId });
  if (saved.error) return saved.error.code === "P0001" ? err(409, "account_linked_to_another_user") : err(500, "save_failed");
  const connId = saved.data as string;
  const watchExpiresAt = new Date(Number(w.expiration)).toISOString();
  await deps.rpc.rpc("gmail_update", { p_user: user, p_connection: connId, p_watch_expires_at: watchExpiresAt });

  let pageToken: string | undefined, pages = 0, count = 0;
  do {
    const l = await api.listMessageIds(BACKFILL_QUERY, pageToken);
    const ids = (l.messages ?? []).map((m) => m.id);
    if (ids.length) {
      const e = await deps.rpc.rpc("enqueue_job", { p_user: user, p_kind: "gmail-fetch", p_lease_key: "gmail:" + connId,
        p_payload: { connection_id: connId, ids } });
      if (e.error) return err(500, "enqueue_failed");
    }
    pageToken = l.nextPageToken; pages++; count += ids.length;
  } while (pageToken);
  // watch 이후 도착분은 history로 받는다(커서 = watch historyId). 백필과 겹치면 idempotency_key가 막는다
  await deps.rpc.rpc("gmail_enqueue_for_account", { p_account_ref: p.emailAddress });
  console.log(JSON.stringify({ gmail_connect: "ok", connection_id: connId, backfill_messages: count, refresh_token: !!t.refresh_token }));
  return Response.json({ connection_id: connId, account: p.emailAddress, refresh_token_stored: !!t.refresh_token,
    watch_expires_at: watchExpiresAt, backfill_pages: pages, backfill_messages: count });
}
