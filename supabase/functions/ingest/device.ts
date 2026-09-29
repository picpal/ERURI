// 기기 등록(스펙 §8 devices): POST /functions/v1/ingest/device, 사용자 JWT 필수.
// body { device_id, apns_token, apns_env: "sandbox"|"production", build } → devices upsert(user_id, device_id). 앱 실행·토큰 갱신마다 보낸다
export type DeviceRow = { user_id: string; device_id: string; apns_token: string; apns_env: "sandbox" | "production"; build: string | null; last_seen_at: string };
export type DeviceDeps = {
  authUser(token: string): Promise<string | null>;
  upsertDevice(userToken: string, row: DeviceRow): Promise<void>;   // 사용자 JWT로 upsert(RLS가 소유자만 허용)
};

export function isDevicePath(url: URL): boolean {
  return /\/ingest\/device\/?$/.test(url.pathname);
}

const bad = (code: string) => Response.json({ error: code }, { status: 400 });

export async function handleDevice(req: Request, deps: DeviceDeps): Promise<Response> {
  const token = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const user = token ? await deps.authUser(token) : null;
  if (!user || !token) return new Response(null, { status: 401 });
  let b: unknown;
  try { b = await req.json(); } catch { return bad("bad_json"); }
  if (!b || typeof b !== "object" || Array.isArray(b)) return bad("bad_body");
  const o = b as Record<string, unknown>;
  if (typeof o.device_id !== "string" || o.device_id.length === 0 || o.device_id.length > 100) return bad("bad_device_id");
  if (typeof o.apns_token !== "string" || !/^[0-9a-f]{64,200}$/i.test(o.apns_token)) return bad("bad_apns_token");
  if (o.apns_env !== "sandbox" && o.apns_env !== "production") return bad("bad_apns_env");
  if (o.build !== undefined && o.build !== null && (typeof o.build !== "string" || o.build.length > 64)) return bad("bad_build");
  await deps.upsertDevice(token, { user_id: user, device_id: o.device_id, apns_token: o.apns_token.toLowerCase(),
    apns_env: o.apns_env, build: (o.build as string | undefined) ?? null, last_seen_at: new Date().toISOString() });
  console.log(JSON.stringify({ ingest: "device", apns_env: o.apns_env }));   // 토큰은 남기지 않는다
  return Response.json({ device_id: o.device_id, apns_env: o.apns_env });
}
