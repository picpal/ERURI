import type { APNsResult, ApnsEnv, ApnsPushType } from "../_shared/apns.ts";
import { SILENT_PAYLOAD, sendWithEnvFallback } from "../_shared/apns.ts";

// PoC-4 부하 시나리오(service 키 호출만): body { token, env? } 또는 { device_id, user_id }(devices의 토큰·환경), count, concurrency.
// PoC-9: silent:true 면 무음 푸시(`content-available:1`, priority 5, apns-push-type background)로 앱을 깨워 큐를 flush 하게 한다.
// 환경 불일치 응답이면 반대 환경으로 1회 재시도한다(sendWithEnvFallback). 응답·로그에 토큰·JWT를 담지 않는다
export type ApnsSendDeps = {
  isService(req: Request): boolean;
  lookupDevice(deviceId: string, userId: string): Promise<{ apns_token: string; apns_env: ApnsEnv } | null>;
  send(o: { token: string; payload: unknown; topic: string; env: ApnsEnv; priority?: 5 | 10; pushType?: ApnsPushType }): Promise<APNsResult>;
  defaultEnv(): ApnsEnv;
  topic(): string;
};

const TOKEN = /^[0-9a-f]{64,200}$/i;
const bad = (code: string, status = 400) => Response.json({ error: code }, { status });

export async function handleApnsSend(req: Request, deps: ApnsSendDeps): Promise<Response> {
  if (!deps.isService(req)) return new Response(null, { status: 403 });
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return bad("bad_json"); }
  let token: string, env: ApnsEnv;
  if (typeof b.device_id === "string" && typeof b.user_id === "string") {
    const d = await deps.lookupDevice(b.device_id, b.user_id);
    if (!d) return bad("device_not_found", 404);
    [token, env] = [d.apns_token, d.apns_env];
  } else if (typeof b.token === "string" && TOKEN.test(b.token)) {
    if (b.env !== undefined && b.env !== "sandbox" && b.env !== "production") return bad("bad_env");
    [token, env] = [b.token, (b.env as ApnsEnv | undefined) ?? deps.defaultEnv()];
  } else {
    return bad("bad_target");
  }
  if (b.silent !== undefined && typeof b.silent !== "boolean") return bad("bad_silent");
  const silent = b.silent === true;
  const count = Math.min(Math.max(Number(b.count ?? 1), 1), 200);
  const concurrency = Math.min(Math.max(Number(b.concurrency ?? 1), 1), 20);
  const topic = deps.topic();
  const byStatus: Record<string, number> = {}, reasons: Record<string, number> = {}, errors: Record<string, number> = {};
  const byEnv: Record<string, number> = {};
  const lat: number[] = [];
  let h2Errors = 0, apnsIds = 0, envRetries = 0, next = 0;
  const t0 = performance.now();
  async function lane() {
    while (next < count) {
      const i = next++;
      const t = performance.now();
      try {
        const r = await sendWithEnvFallback(deps.send, silent
          ? { token, topic, env, payload: SILENT_PAYLOAD, priority: 5, pushType: "background" }
          : { token, topic, env, payload: { aps: { alert: { title: "PoC-4", body: `합성 알림 ${i + 1}/${count}` } } } });
        lat.push(performance.now() - t);
        byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
        if (r.reason) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
        if (r.apnsId) apnsIds++;
        if (r.retried) envRetries++;
        if (r.status === 200) byEnv[r.env] = (byEnv[r.env] ?? 0) + 1;
      } catch (e) {
        const cause = e instanceof Error && e.cause instanceof Error ? ` | cause: ${e.cause.message}` : "";
        const msg = e instanceof Error ? `${e.name}: ${e.message}${cause}` : "error";
        if (/http2|stream/i.test(msg)) h2Errors++;
        // 토큰·주소를 가리고 원인이 담긴 뒷부분을 남긴다
        const key = msg.replace(/[0-9a-f]{64,}/gi, "<token>").replace(/\[[0-9a-f:]+\]:\d+/gi, "<addr>").replace(/\([^)]*\)/, "").slice(-220);
        errors[key] = (errors[key] ?? 0) + 1;
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, lane));
  lat.sort((x, y) => x - y);
  const pct = (p: number) => lat.length ? Math.round(lat[Math.min(lat.length - 1, Math.ceil(p * lat.length) - 1)]) : null;
  const out = { ok: byStatus["200"] ?? 0, count, concurrency, env, silent, envRetries, byEnv, byStatus, reasons, h2Errors, errors, apnsIds,
    ms: { total: Math.round(performance.now() - t0), p50: pct(0.5), p95: pct(0.95), max: pct(1) } };
  console.log(JSON.stringify({ apns_send: { ...out, errors: Object.keys(errors).length } }));
  return Response.json(out);
}
