import type { RpcClient } from "../_shared/gmail-jobs.ts";
import { GMAIL_READONLY_SCOPE, type GmailClient, GmailHttpError, type TokenResponse } from "../_shared/gmail.ts";

// iOS → POST /functions/v1/gmail-connect  (Authorization: Bearer <Supabase 사용자 access token>, body { code: serverAuthCode })
// 코드 교환(Web 클라이언트) → gmail.readonly 범위 확인 → profile → gmail_save_connection(refresh token은 vault)
// → watch → watch 만료 기록 → 90일 백필 gmail-fetch 잡 → gmail-sync 잡.
// 저장 전에 실패하면 받은 refresh token을 폐기하고(교환된 코드는 재사용 불가, 다음 로그인에서 재동의), 저장 후 실패하면 토큰을 남긴다.
// 응답·로그에 토큰·코드를 담지 않는다
export type ConnectDeps = {
  authUser(token: string): Promise<string | null>;
  exchange(code: string): Promise<TokenResponse>;
  revoke(token: string): Promise<void>;
  api(accessToken: string): Pick<GmailClient, "profile" | "watch" | "listMessageIds">;
  rpc: RpcClient;
  topic(): string;
};

const BACKFILL_QUERY = "newer_than:90d -category:promotions";
const err = (status: number, code: string, extra: Record<string, unknown> = {}) => Response.json({ error: code, ...extra }, { status });

// Google 상태 → 응답. 401/403은 사용자 재동의가 필요하다(reauth_required), 429/5xx는 일시 오류(active 유지)
function mapGmail(e: GmailHttpError): { status: number; code: string; reauth: boolean } {
  if (e.status === 401) return { status: 401, code: "gmail_unauthorized", reauth: true };
  if (e.status === 403) return { status: 403, code: "gmail_forbidden", reauth: true };
  if (e.status === 429) return { status: 429, code: "gmail_rate_limited", reauth: false };
  return { status: 502, code: "gmail_upstream", reauth: false };
}

export async function handleConnect(req: Request, deps: ConnectDeps): Promise<Response> {
  const requestId = crypto.randomUUID();
  let stage = "auth";
  let pendingRefreshToken: string | null = null;           // 교환했지만 아직 vault에 없는 refresh token
  const log = (o: Record<string, unknown>) => console.log(JSON.stringify({ gmail_connect: o.result, request_id: requestId, stage, ...o }));
  const discardToken = async () => {
    if (!pendingRefreshToken) return;
    const t = pendingRefreshToken;
    pendingRefreshToken = null;
    try { await deps.revoke(t); log({ result: "token_revoked" }); } catch { log({ result: "revoke_failed" }); }
  };
  try {
    const token = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    const user = token ? await deps.authUser(token) : null;
    if (!user) return new Response(null, { status: 401 });
    let body: { code?: unknown };
    try { body = await req.json(); } catch { return err(400, "bad_json"); }
    if (typeof body.code !== "string" || body.code.length === 0) return err(400, "missing_code");

    stage = "exchange";
    let t: TokenResponse;
    try { t = await deps.exchange(body.code); } catch (e) {
      log({ result: "exchange_failed", detail: e instanceof Error ? e.message.slice(0, 40) : "" });
      return err(502, "token_exchange_failed");
    }
    pendingRefreshToken = t.refresh_token ?? null;

    stage = "scope";
    if (!(t.scope ?? "").split(/\s+/).includes(GMAIL_READONLY_SCOPE)) {
      await discardToken();
      log({ result: "gmail_scope_missing" });
      return err(403, "gmail_scope_missing");
    }

    const api = deps.api(t.access_token);
    stage = "profile";
    const p = await api.profile();

    stage = "save";
    const saved = await deps.rpc.rpc("gmail_save_connection", { p_user: user, p_account_ref: p.emailAddress,
      p_refresh_token: t.refresh_token ?? null, p_history_id: p.historyId });
    if (saved.error) {
      await discardToken();
      return saved.error.code === "P0001" ? err(409, "account_linked_to_another_user") : err(500, "save_failed");
    }
    pendingRefreshToken = null;                                // 이제 vault에 있다
    const connId = saved.data as string;

    try {
      stage = "watch";
      const w = await api.watch(deps.topic());
      const watchExpiresAt = new Date(Number(w.expiration)).toISOString();
      await deps.rpc.rpc("gmail_update", { p_user: user, p_connection: connId, p_watch_expires_at: watchExpiresAt });

      stage = "backfill";
      let pageToken: string | undefined, pages = 0, count = 0;
      do {
        const l = await api.listMessageIds(BACKFILL_QUERY, pageToken);
        const ids = (l.messages ?? []).map((m) => m.id);
        if (ids.length) {
          const e = await deps.rpc.rpc("enqueue_job", { p_user: user, p_kind: "gmail-fetch", p_lease_key: "backfill:" + user,
            p_payload: { connection_id: connId, ids, backfill: true } });   // 백필 레인: 사용자당 1개, 우선순위 40(§7)
          if (e.error) return err(500, "enqueue_failed");
        }
        pageToken = l.nextPageToken; pages++; count += ids.length;
      } while (pageToken);
      // 커서 = profile historyId(watch 이전)라 이후 도착분은 history로 받는다. 백필과 겹치면 idempotency_key가 막는다
      await deps.rpc.rpc("gmail_enqueue_for_account", { p_account_ref: p.emailAddress });
      log({ result: "ok", backfill_messages: count, refresh_token: !!t.refresh_token });
      return Response.json({ connection_id: connId, account: p.emailAddress, refresh_token_stored: !!t.refresh_token,
        watch_expires_at: watchExpiresAt, backfill_pages: pages, backfill_messages: count });
    } catch (e) {
      if (!(e instanceof GmailHttpError)) throw e;
      const m = mapGmail(e);
      // 토큰은 vault에 남긴다. 재동의가 필요한 오류면 연결을 reauth_required로(워커 잡은 skipped, 재연결 시 active)
      if (m.reauth) await deps.rpc.rpc("gmail_update", { p_user: user, p_connection: connId, p_status: "reauth_required" });
      log({ result: m.code, google_status: e.status, connection_id: connId });
      return err(m.status, m.code);
    }
  } catch (e) {
    if (e instanceof GmailHttpError) {                         // 저장 전(profile) 실패: 토큰 폐기
      await discardToken();
      const m = mapGmail(e);
      log({ result: m.code, google_status: e.status });
      return err(m.status, m.code);
    }
    await discardToken();
    log({ result: "internal", error: e instanceof Error ? e.name : "unknown" });   // 메시지는 토큰을 담을 수 있어 남기지 않는다
    return err(500, "internal", { request_id: requestId });
  }
}
