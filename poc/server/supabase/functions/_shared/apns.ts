// APNs 토큰 인증(.p8, ES256 JWT) + HTTP/2 발송. APNs는 HTTP/2만 받으므로 fetch가 h2로 협상해야 한다(스펙 §16).
// 로그·오류에 기기 토큰·JWT·페이로드를 남기지 않는다.
// 캐시는 생성 중인 Promise째 둔다: 동시 호출이 JWT를 각자 만들면 APNs가 429 TooManyProviderTokenUpdates를 준다(PoC-4 실측)
let cached: { jwt: Promise<string>; bucket: number; keyId: string } | null = null;
export function __resetJWTCache() { cached = null; }

// Apple: 20분 이상 60분 이하 간격으로 갱신. iat를 30분 경계로 내림해 isolate가 달라도 같은 iat를 쓰게 한다(iat 나이 ≤ 30분)
const REFRESH_SECONDS = 30 * 60;

function b64url(b: ArrayBuffer | Uint8Array | string) {
  const bytes = typeof b === "string" ? new TextEncoder().encode(b) : new Uint8Array(b);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// .env 한 줄 표기(`\n` 문자 그대로)와 여러 줄 PEM(secrets) 둘 다 받는다
export function normalizeP8(p8: string): string {
  return p8.replace(/\\n/g, "\n");
}

export function makeJWT(o: { keyId: string; teamId: string; p8: string }, now = Math.floor(Date.now() / 1000)): Promise<string> {
  const bucket = now - (now % REFRESH_SECONDS);
  if (cached && cached.keyId === o.keyId && cached.bucket === bucket) return cached.jwt;
  const jwt = signJWT(o, bucket);
  const entry = { jwt, bucket, keyId: o.keyId };
  cached = entry;
  jwt.catch(() => { if (cached === entry) cached = null; });
  return jwt;
}

async function signJWT(o: { keyId: string; teamId: string; p8: string }, iat: number): Promise<string> {
  const pem = normalizeP8(o.p8).replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
  const key = await crypto.subtle.importKey("pkcs8", Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)),
    { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = b64url(JSON.stringify({ alg: "ES256", kid: o.keyId })), claims = b64url(JSON.stringify({ iss: o.teamId, iat }));
  // WebCrypto ECDSA 서명은 r||s 64바이트(P1363)로 JWS ES256 형식과 같다
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${head}.${claims}`));
  return `${head}.${claims}.${b64url(sig)}`;
}

export type APNsResult = { status: number; apnsId?: string; reason?: string };

export async function sendAPNs(o: { token: string; payload: unknown; topic: string; priority?: 5 | 10; sandbox?: boolean }): Promise<APNsResult> {
  const jwt = await makeJWT({ keyId: Deno.env.get("APNS_KEY_ID")!, teamId: Deno.env.get("APNS_TEAM_ID")!, p8: Deno.env.get("APNS_P8")! });
  const host = o.sandbox === false ? "api.push.apple.com" : "api.sandbox.push.apple.com";
  const r = await fetch(`https://${host}/3/device/${o.token}`, { method: "POST",
    headers: { authorization: `bearer ${jwt}`, "apns-topic": o.topic, "apns-priority": String(o.priority ?? 10), "apns-push-type": "alert" },
    body: JSON.stringify(o.payload) });
  const apnsId = r.headers.get("apns-id") ?? undefined;
  if (r.status === 200) { await r.body?.cancel(); return { status: 200, apnsId }; }
  return { status: r.status, apnsId, reason: (await r.json().catch(() => ({}))).reason };
}
