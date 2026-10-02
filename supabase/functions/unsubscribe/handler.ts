// 광고 구독 해지 요청(스펙 §7 "광고 구독 해지"). 사용자 JWT 필수, 사용자는 JWT 에서만 정한다(verify_jwt = false — sink 때문에 핸들러가 인증한다).
// unsub_begin(행 잠금·방법 확인·복호화 감사) → URL 복호화 → 안전 POST → unsub_finish. 응답·로그에 주소·URL 없음, 결과 코드만
export type UnsubDeps = {
  authUser(token: string): Promise<string | null>;
  begin(user: string, sender: string): Promise<{ result: string; url_enc?: string }>;
  decrypt(user: string, enc: string): Promise<string>;
  post(url: string): Promise<{ ok: boolean; code: string }>;
  finish(user: string, sender: string, code: string): Promise<void>;
};
export type Sink = { base: string; key: string } | null;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 스모크·시뮬레이터 게이트 전용 수신처: 공인 주소 경로의 실제 POST·307 을 잰다. secret UNSUB_SINK_KEY 경로에서만 열린다(리뷰 N10).
// 본문이 정확히 원클릭 문자열일 때만 200, 아무것도 저장·기록하지 않는다
async function sink(req: Request, path: string, s: Sink): Promise<Response> {
  const m = path.match(/\/unsubscribe\/sink\/([^/]+)(\/redirect)?\/?$/);
  if (!s || !m || m[1] !== s.key) return new Response(null, { status: 404 });
  if (req.method !== "POST") return new Response(null, { status: 405 });
  const body = (await req.text().catch(() => "")).trim();
  if (body !== "List-Unsubscribe=One-Click") return new Response(null, { status: 400 });
  if (m[2]) return new Response(null, { status: 307, headers: { location: `${s.base}/${s.key}` } });
  return new Response(null, { status: 200 });
}

export async function handleUnsubscribe(req: Request, deps: UnsubDeps, sinkCfg: Sink): Promise<Response> {
  const path = new URL(req.url).pathname;
  if (/\/unsubscribe\/sink(\/|$)/.test(path)) return await sink(req, path, sinkCfg);
  const token = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const user = token ? await deps.authUser(token) : null;
  if (!user) return new Response(null, { status: 401 });
  if (req.method !== "POST") return new Response(null, { status: 405 });
  let b: { sender_id?: unknown };
  try { b = await req.json(); } catch { return Response.json({ error: "bad_json" }, { status: 400 }); }
  const sender = typeof b?.sender_id === "string" && UUID.test(b.sender_id) ? b.sender_id : null;
  if (!sender) return Response.json({ error: "bad_sender" }, { status: 400 });
  const begin = await deps.begin(user, sender);
  if (begin.result !== "ok" || !begin.url_enc) {
    console.log(JSON.stringify({ unsubscribe: begin.result }));
    return Response.json({ result: begin.result });
  }
  let code: string;
  try { code = (await deps.post(await deps.decrypt(user, begin.url_enc))).code; }
  catch { code = "error"; }
  await deps.finish(user, sender, code);
  const result = code === "ok" ? "requested" : "failed";                // 2xx 만 접수(리뷰 M1)
  console.log(JSON.stringify({ unsubscribe: result, code }));
  return Response.json({ result, code });
}
