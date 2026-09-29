// 전체 삭제·Gmail 출처 삭제(스펙 §8 삭제 정책, §12 통제 5 — 1단계 설정 버튼 2개). 사용자 JWT 필수, 사용자는 JWT 에서만 정한다.
// 순서: 토큰 revoke(실패해도 계속) → (전체) 기기 삭제 푸시 → Storage → 감사 → 사용자 삭제(cascade, user_keys 삭제 = crypto-shred).
// 응답·로그에 토큰·주소·본문 없음
export type AccountDeps = {
  authUser(token: string): Promise<string | null>;
  connections(userId: string): Promise<string[]>;
  refreshToken(userId: string, connectionId: string): Promise<string | null>;
  revoke(token: string): Promise<void>;
  deleteGmailSource(userId: string, connectionId: string): Promise<Record<string, number>>;
  wipeDevices(userId: string): Promise<number>;
  removeStorage(userId: string): Promise<number>;
  audit(userId: string, action: string, target: string | null): Promise<void>;
  deleteUser(userId: string): Promise<void>;
};

async function revokeAll(deps: AccountDeps, user: string, conns: string[]) {
  let revoked = 0, failed = 0;
  for (const c of conns) {
    try {
      const t = await deps.refreshToken(user, c);
      if (t) { await deps.revoke(t); revoked++; }
    } catch {
      failed++;
    }
  }
  return { revoked, revoke_failed: failed };
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
    console.log(JSON.stringify({ account: "source_delete", connections: conns.length, ...r }));
    return Response.json({ provider: "gmail", connections: conns.length, ...r, deleted });
  }
  if (/\/account\/delete\/?$/.test(path)) {
    const conns = await deps.connections(user);
    const r = await revokeAll(deps, user, conns);
    const wiped = await deps.wipeDevices(user).catch(() => 0);
    const files = await deps.removeStorage(user);
    await deps.audit(user, "account_delete", null);
    await deps.deleteUser(user);
    console.log(JSON.stringify({ account: "delete", ...r, devices_wiped: wiped, files_removed: files }));
    return Response.json({ deleted: true, ...r, devices_wiped: wiped, files_removed: files });
  }
  return new Response(null, { status: 404 });
}
