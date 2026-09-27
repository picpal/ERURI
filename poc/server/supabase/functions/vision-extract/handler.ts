import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import type { ExtractedEvent, ExtractInput, ExtractUsage } from "../_shared/extract.ts";
import { mediaTypeOf } from "../worker/extract.ts";

// PoC-8 측정용(Task 12 Step 2): body { storagePath?: 'poc/<user>/<파일>', ocrText? } → Storage → extractEvent → JSON.
// service role로 Storage를 읽으므로 secret 키 호출만 받는다. 사용량 상한은 worker extract 경로가 맡는다
export type VisionDeps = {
  isServiceCaller(req: Request): boolean;
  download(bucket: string, path: string): Promise<Uint8Array>;
  extract(input: ExtractInput): Promise<{ event: ExtractedEvent; usage: ExtractUsage; ms: number }>;
};

export async function handleVisionExtract(req: Request, deps: VisionDeps): Promise<Response> {
  if (!deps.isServiceCaller(req)) return new Response(null, { status: 403 });
  let b: { storagePath?: unknown; ocrText?: unknown };
  try { b = await req.json(); } catch { return new Response(null, { status: 400 }); }
  const ocrText = typeof b.ocrText === "string" && b.ocrText.trim() ? b.ocrText : undefined;
  const path = typeof b.storagePath === "string" ? b.storagePath : undefined;
  if (!path && !ocrText) return new Response(null, { status: 400 });
  let input: ExtractInput = { ocrText };
  let bytes = 0;
  if (path) {
    const [bucket, ...rest] = path.split("/");
    const type = mediaTypeOf(path);
    if (bucket !== "poc" || rest.length === 0 || rest.includes("..") || !type) return new Response(null, { status: 400 });
    const data = await deps.download(bucket, rest.join("/"));
    bytes = data.length;
    const b64 = encodeBase64(data);
    input = type === "application/pdf" ? { pdfBase64: b64, ocrText } : { imageBase64: b64, mediaType: type, ocrText };
  }
  try {
    const r = await deps.extract(input);
    return Response.json({ ...r.event, usage: r.usage, model_ms: r.ms, bytes });
  } catch (e) {
    // 오류 코드만(본문·추출값 없음)
    return Response.json({ error: (e instanceof Error ? e.message : "error").slice(0, 120) }, { status: 502 });
  }
}
