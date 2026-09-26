// 게이트웨이 JWT 검증은 publishable(anon) 키도 통과시킨다(PoC-10 실측). service role로 도는 함수는
// Bearer가 런타임이 주입한 secret 키와 같을 때만 처리한다(스펙 §12 통제 4). 키 형식(legacy JWT / sb_secret_)에 의존하지 않는다
const SECRET_KEYS = new Set<string>([
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  ...Object.values(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}") as Record<string, string>),
].filter((k) => k.length > 0));

export function isServiceCaller(req: Request): boolean {
  const token = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
  return SECRET_KEYS.has(token);
}
