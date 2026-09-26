import { isServiceCaller } from "../_shared/auth.ts";
import { sendAPNs } from "../_shared/apns.ts";

// PoC-4 부하 시나리오: body { token, count, concurrency, sandbox? } → count회 sendAPNs를 concurrency 동시로 실행.
// h2 오류는 fetch가 throw한 메시지에 http2/stream 포함 여부로 센다. 응답·로그에 토큰·JWT를 담지 않는다
Deno.serve(async (req) => {
  if (!isServiceCaller(req)) return new Response(null, { status: 403 });
  let b: { token?: unknown; count?: unknown; concurrency?: unknown; sandbox?: unknown };
  try { b = await req.json(); } catch { return new Response(null, { status: 400 }); }
  if (typeof b.token !== "string" || !/^[0-9a-f]{64,200}$/i.test(b.token)) return new Response(null, { status: 400 });
  const token = b.token;
  const count = Math.min(Math.max(Number(b.count ?? 1), 1), 200);
  const concurrency = Math.min(Math.max(Number(b.concurrency ?? 1), 1), 20);
  const topic = Deno.env.get("APNS_TOPIC")!;
  const byStatus: Record<string, number> = {}, reasons: Record<string, number> = {}, errors: Record<string, number> = {};
  const lat: number[] = [];
  let h2Errors = 0, apnsIds = 0, next = 0;
  const t0 = performance.now();
  async function lane() {
    while (next < count) {
      const i = next++;
      const t = performance.now();
      try {
        const r = await sendAPNs({ token, topic, sandbox: b.sandbox !== false, payload: { aps: { alert: { title: "PoC-4", body: `합성 알림 ${i + 1}/${count}` } } } });
        lat.push(performance.now() - t);
        byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
        if (r.reason) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
        if (r.apnsId) apnsIds++;
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
  const out = { ok: byStatus["200"] ?? 0, count, concurrency, byStatus, reasons, h2Errors, errors, apnsIds,
    ms: { total: Math.round(performance.now() - t0), p50: pct(0.5), p95: pct(0.95), max: pct(1) } };
  console.log(JSON.stringify({ apns_send: { ...out, errors: Object.keys(errors).length } }));
  return Response.json(out);
});
