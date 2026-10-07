import type { RpcClient } from "../_shared/gmail-jobs.ts";
import { GMAIL_MODIFY_SCOPE, GMAIL_READONLY_SCOPE, type GmailClient, GmailHttpError, type TokenResponse } from "../_shared/gmail.ts";

// iOS → POST /functions/v1/gmail-connect  (Authorization: Bearer <Supabase 사용자 access token>, body { code: serverAuthCode })
// 코드 교환(Web 클라이언트) → gmail.readonly 범위 확인 → profile → gmail_save_connection(refresh token은 vault)
// → watch → watch 만료 기록 → 90일 백필 gmail-fetch 잡 → gmail-sync 잡.
// 저장 전에 실패하면 받은 refresh token을 폐기하고(교환된 코드는 재사용 불가, 다음 로그인에서 재동의), 저장 후 실패하면 토큰을 남긴다.
// 응답·로그에 토큰·코드를 담지 않는다
export type ConnectDeps = {
  authUser(token: string): Promise<string | null>;
  exchange(code: string): Promise<TokenResponse>;
  revoke(token: string): Promise<void>;
  refresh(refreshToken: string): Promise<string>;   // 권한 업데이트: 새 토큰으로 갱신 1회 확인(D12)
  api(accessToken: string): Pick<GmailClient, "profile" | "watch" | "listMessageIds">;
  rpc: RpcClient;
  topic(): string;
};

const BACKFILL_QUERY = "newer_than:90d -category:promotions -in:drafts";
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
    let body: { code?: unknown; upgrade?: unknown };
    try { body = await req.json(); } catch { return err(400, "bad_json"); }
    if (typeof body.code !== "string" || body.code.length === 0) return err(400, "missing_code");
    // upgrade 는 불리언만 — 형식이 틀린 요청이 일반 연결(커서 덮기·백필)로 흘러가지 않게(D12)
    if (body.upgrade !== undefined && typeof body.upgrade !== "boolean") return err(400, "bad_upgrade");
    if (body.upgrade === true) return await handleUpgrade(user, body.code, deps, log);

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
    // 승인 scope 기록(스펙 §8 connections.scopes, 0.14.0) — 새 refresh token 을 저장했을 때만(아니면 vault 에는 옛 토큰이 남아 scope 와 어긋난다).
    // 실패해도 연결은 성공 — readonly 로 보여 [권한 업데이트]가 남을 뿐(D12)
    if (t.refresh_token) {
      try {
        const sc = await deps.rpc.rpc("gmail_set_scopes", { p_user: user, p_connection: connId, p_scopes: (t.scope ?? "").split(/\s+/).filter(Boolean) });
        if (sc.error) log({ result: "scopes_save_failed" });
      } catch { log({ result: "scopes_save_failed" }); }
    }

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

// 권한 업데이트(스펙 §7 "권한 업데이트", 계획 D12): 기존 연결을 그대로 두고 refresh token 만 바꾼다. 어떤 실패에서도 새 토큰을 revoke 하지 않는다 —
// revoke 는 그 토큰이 속한 승인을 철회해 같은 계정·클라이언트로 저장된 기존 토큰까지 끊을 수 있다. 실패면 메모리에서 버리기만(만료까지 Google 에 남는 1개는 수용).
// 교체가 성공하기 전에는 connections·vault·sync_states·잡을 건드리지 않는다(gmail_save_connection·watch·백필 없음)
async function handleUpgrade(user: string, code: string, deps: ConnectDeps, log: (o: Record<string, unknown>) => void): Promise<Response> {
  let stage = "upgrade_exchange";
  const out = (status: number, name: string) => { log({ result: name, upgrade_stage: stage }); return err(status, name); };
  try {
    let t: TokenResponse;
    try { t = await deps.exchange(code); } catch { return out(502, "token_exchange_failed"); }
    stage = "upgrade_connection";
    const c = await deps.rpc.rpc("mail_connection", { p_user: user });
    if (c.error) return out(500, "internal");
    const conn = (c.data as { connection_id: string; account_ref: string; status: string }[] | null)?.[0];
    if (!conn) return out(404, "no_connection");
    if (conn.status !== "active") return out(409, "reauth_required");   // 끊긴 연결은 기존 재연결로 — upgrade 가 되살리면 sync 가 다음 cron 까지 쉰다(D12)
    stage = "upgrade_profile";
    const p = await deps.api(t.access_token).profile();
    if (p.emailAddress.toLowerCase() !== conn.account_ref.toLowerCase()) return out(409, "account_mismatch");
    if (!t.refresh_token) {                                          // 이전 동의 때문에 Google 이 다시 주지 않음 → 다음 재연결 때(스펙 §7)
      log({ result: "no_refresh_token", upgrade_stage: stage });
      return Response.json({ connection_id: conn.connection_id, refresh_token_stored: false, upgraded: false });
    }
    const scopes = (t.scope ?? "").split(/\s+/).filter(Boolean);
    // modify 와 readonly 둘 다(스펙 §7 — 읽기 경로는 readonly 승인을 전제한다. modify 단독 토큰으로 옛 토큰을 덮지 않는다)
    if (!scopes.includes(GMAIL_MODIFY_SCOPE) || !scopes.includes(GMAIL_READONLY_SCOPE)) return out(403, "gmail_scope_missing");
    stage = "upgrade_verify";
    try { await deps.refresh(t.refresh_token); } catch { return out(502, "token_verify_failed"); }
    stage = "upgrade_replace";
    const r = await deps.rpc.rpc("gmail_replace_token", { p_user: user, p_connection: conn.connection_id, p_refresh_token: t.refresh_token, p_scopes: scopes });
    if (r.error || r.data !== true) return out(500, "replace_failed");
    log({ result: "upgraded", upgrade_stage: stage });
    return Response.json({ connection_id: conn.connection_id, refresh_token_stored: true, upgraded: true });
  } catch (e) {
    if (e instanceof GmailHttpError) {                               // 연결 상태는 바꾸지 않는다(reauth 표시 없음)
      const m = mapGmail(e);
      return out(m.status === 401 ? 502 : m.status, m.code);         // 401 이면 앱이 세션을 바꿔 소비된 일회용 코드를 다시 보낸다 — 502 로
    }
    log({ result: "internal", upgrade_stage: stage, error: e instanceof Error ? e.name : "unknown" });   // 메시지는 토큰을 담을 수 있어 남기지 않는다
    return err(500, "internal");
  }
}
