import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from "npm:jose@5";

// Pub/Sub push 수신(verify_jwt = false). 인증은 push 구독의 OIDC 토큰:
// Google 공개키 서명 + aud(구독에 설정한 audience) + email(push용 서비스 계정, email_verified)만 통과(스펙 §7)
const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export async function verifyPubSubToken(authHeader: string | null,
  o: { audience: string; email: string | undefined; jwks?: JWTVerifyGetKey }): Promise<boolean> {
  if (!o.email) return false;             // 서비스 계정 미설정이면 거부
  const token = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, o.jwks ?? GOOGLE_JWKS, {
      audience: o.audience, issuer: ["https://accounts.google.com", "accounts.google.com"], algorithms: ["RS256"],
    });
    return payload.email === o.email && payload.email_verified === true;
  } catch {
    return false;
  }
}

export type WebhookDeps = {
  verify(authHeader: string | null): Promise<boolean>;
  enqueue(emailAddress: string): Promise<boolean>;   // 새 gmail-sync 잡이 생겼으면 true
};

// 검증 실패 401. 그 외에는 200으로 ack한다(모르는 계정·형식 오류도 재전송 폭주를 막으려고 ack, 로그에는 코드만)
export async function handleWebhook(req: Request, deps: WebhookDeps): Promise<Response> {
  if (!await deps.verify(req.headers.get("authorization"))) return new Response(null, { status: 401 });
  let email: unknown;
  try {
    const b = await req.json() as { message?: { data?: string } };
    email = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b.message?.data ?? ""), (c) => c.charCodeAt(0)))).emailAddress;
  } catch {
    email = undefined;
  }
  if (typeof email !== "string" || !email.includes("@")) {
    console.log(JSON.stringify({ gmail_webhook: "bad_message" }));
    return new Response(null, { status: 200 });
  }
  const created = await deps.enqueue(email);
  console.log(JSON.stringify({ gmail_webhook: created ? "queued" : "no_new_job" }));   // 주소는 남기지 않는다
  return new Response(null, { status: 200 });
}
