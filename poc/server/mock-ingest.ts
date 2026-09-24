const received: Record<string, unknown>[] = [];
const port = Number(Deno.env.get("MOCK_INGEST_PORT") ?? 8787);
// PoC-9 측정 전용: 루프백은 파일 전송이 수백 ms 안에 끝나 "앱 강제 종료가 전송 도중에 일어났는지"를
// 가늠하기 어렵다. MOCK_INGEST_SLOW_MS 를 설정하면 업로드 바디를 청크 단위로 천천히 읽어
// 클라이언트 쪽 업로드가 실제로 더 오래 "진행 중" 상태로 남도록 인위적 지연을 준다. 기본값(0)은 계획서 동작과 동일.
const slowMs = Number(Deno.env.get("MOCK_INGEST_SLOW_MS") ?? 0);
Deno.serve({ port }, async (req) => {
  const u = new URL(req.url);
  if (u.pathname === "/ingest") { received.push(await req.json()); return new Response("ok", { status: 202 }); }
  if (u.pathname.startsWith("/upload/")) {
    let bytes = 0;
    if (slowMs > 0 && req.body) {
      const reader = req.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        await new Promise((r) => setTimeout(r, slowMs));
      }
    } else {
      bytes = (await req.arrayBuffer()).byteLength;
    }
    received.push({ file: u.pathname, bytes, at: new Date().toISOString() });
    return new Response("ok");
  }
  if (u.pathname === "/received") return Response.json(received);
  return new Response("nf", { status: 404 });
});
