import type { ApnsEnv } from "../_shared/apns.ts";
// 전체 삭제·Gmail 출처 삭제(스펙 §8 삭제 정책, §12 통제 5 — 1단계 설정 버튼 2개). 사용자 JWT 필수, 사용자는 JWT 에서만 정한다.
// 출처 삭제: 토큰 revoke(실패해도 계속) → 연결마다 삭제. 연결이 이미 없어도 사용자 Gmail 항목 삭제는 1회 수행(재시도로 복구, 리뷰 #1b).
// 전체 삭제: 기기 목록 선조회 → revoke → Storage(실패면 중단) → 사용자 삭제(cascade, user_keys 삭제 = crypto-shred)
//   → 성공한 뒤에만 감사 행(audit_log 는 FK 없음)·보관한 토큰으로 기기 삭제 푸시. 사용자 삭제가 실패하면 기기·감사는 그대로(리뷰 #2).
// 응답·로그에 토큰·주소·본문 없음
export type Device = { apns_token: string; apns_env: ApnsEnv };
export type AccountDeps = {
  authUser(token: string): Promise<string | null>;
  connections(userId: string): Promise<string[]>;
  refreshToken(userId: string, connectionId: string): Promise<string | null>;
  revoke(token: string): Promise<void>;
  deleteGmailSource(userId: string, connectionId: string | null): Promise<Record<string, number>>;
  listDevices(userId: string): Promise<Device[]>;
  wipe(devices: Device[]): Promise<number>;
  removeStorage(userId: string): Promise<number>;
  audit(userId: string, action: string, target: string | null): Promise<void>;
  deleteUser(userId: string): Promise<void>;
};

async function revokeAll(deps: AccountDeps, user: string, conns: string[]) {
  let revoked = 0, failed = 0, skipped = 0;
  for (const c of conns) {
    try {
      const t = await deps.refreshToken(user, c);
      if (t) { await deps.revoke(t); revoked++; } else skipped++;   // active 아닌 연결: grant 는 이미 무효, vault 토큰은 cascade 로 삭제
    } catch {
      failed++;
    }
  }
  return { revoked, revoke_failed: failed, revoke_skipped: skipped };
}

export async function handleAccount(req: Request, deps: AccountDeps): Promise<Response> {
  const token = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const user = token ? await deps.authUser(token) : null;
  if (!user) return new Response(null, { status: 401 });
  if (req.method !== "POST") return new Response(null, { status: 405 });
  const path = new URL(req.url).pathname;
  if (/\/account\/source\/?$/.test(path)) {
    let b: { provider?: unknown };
    try { b = await req.json(); } catch { return Response.json({ error: "bad_json" }, { status: 400 }); }
    if (b?.provider !== "gmail") return Response.json({ error: "bad_provider" }, { status: 400 });
    const conns = await deps.connections(user);
    const r = await revokeAll(deps, user, conns);
    const deleted: Record<string, number>[] = [];
    for (const c of conns) deleted.push(await deps.deleteGmailSource(user, c));
    if (conns.length === 0) deleted.push(await deps.deleteGmailSource(user, null));   // 연결 삭제 뒤 남은 항목도 지운다
    console.log(JSON.stringify({ account: "source_delete", connections: conns.length, ...r }));
    return Response.json({ provider: "gmail", connections: conns.length, ...r, deleted });
  }
  if (/\/account\/delete\/?$/.test(path)) {
    const conns = await deps.connections(user);
    const devices = await deps.listDevices(user);          // 사용자 삭제 뒤엔 devices 행이 cascade 로 사라진다
    const r = await revokeAll(deps, user, conns);
    const files = await deps.removeStorage(user);
    await deps.deleteUser(user);
    // 여기부터 사용자는 이미 없다: 실패해도 500 을 주지 않는다(재시도는 401). 감사 실패는 로그만
    await deps.audit(user, "account_delete", null).catch((e) => console.log(JSON.stringify({ account: "delete", audit_failed: String(e?.message ?? e) })));
    const wiped = await deps.wipe(devices).catch(() => 0);
    console.log(JSON.stringify({ account: "delete", ...r, devices_wiped: wiped, files_removed: files }));
    return Response.json({ deleted: true, ...r, devices_wiped: wiped, files_removed: files });
  }
  return new Response(null, { status: 404 });
}
