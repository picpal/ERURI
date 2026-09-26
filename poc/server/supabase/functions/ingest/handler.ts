import { applyRules } from "../_shared/rules.ts";

// 기기 CaptureItem(Task 3) JSON. localFile 항목은 이 경로로 오지 않는다(파일은 Storage 경로)
export type IngestBody = {
  id: string; source: string; appName?: string | null; sender?: string | null; title?: string | null;
  text: string; ocrText?: string | null; capturedAt: number | string;
};
export type NewItem = {
  user: string; source: string; idempotencyKey: string; appName: string | null; sender: string | null;
  title: string | null; contentEnc: Uint8Array; ocrTextEnc: Uint8Array | null; occurredAt: string;
};
export type IngestDeps = {
  authUser(token: string): Promise<string | null>;                       // JWT → user_id, 실패 시 null
  encrypt(userId: string, plaintext: string): Promise<Uint8Array>;
  insertItem(item: NewItem): Promise<string | null>;                      // 중복이면 null
};

const SOURCES = new Set(["MESSAGES", "NOTIFICATION", "SHARE", "CHAT"]);   // GMAIL은 서버가 직접 수집
const APPLE_EPOCH = 978307200;                                           // Swift JSONEncoder 기본 Date = 2001-01-01 기준 초

export function parseCapturedAt(v: unknown): string | null {
  const ms = typeof v === "number" ? (v + APPLE_EPOCH) * 1000 : typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function discarded(reason: string) {
  console.log(JSON.stringify({ ingest: "discard", reason }));             // 사유 코드만, 본문 금지
  return new Response(null, { status: 204 });
}

// 스펙 §7 /ingest: JWT → 서버 규칙 필터 → 암호화 → items INSERT + jobs(process) → 202
export async function handleIngest(req: Request, deps: IngestDeps): Promise<Response> {
  const token = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const user = token ? await deps.authUser(token) : null;
  if (!user) return new Response(null, { status: 401 });
  let b: IngestBody;
  try { b = await req.json(); } catch { return new Response(null, { status: 400 }); }
  const occurredAt = parseCapturedAt(b?.capturedAt);
  if (typeof b?.id !== "string" || typeof b.text !== "string" || !SOURCES.has(b.source) || !occurredAt) {
    return new Response(null, { status: 400 });
  }
  // OTP 판정은 제목+본문 합쳐서, 마스킹은 각각(§6)
  const v = applyRules(b.text, { sender: b.sender, title: b.title ?? null });
  if (v.kind === "discard") return discarded(v.reason);
  let ocr: string | null = null;
  if (b.ocrText) {
    const o = applyRules(b.ocrText);                                      // 기기에서 적용된 OCR에도 재적용(§12 통제 2)
    if (o.kind === "discard") return discarded(o.reason);
    ocr = o.masked;
  }
  const itemId = await deps.insertItem({
    user, source: b.source, idempotencyKey: `${b.source}:${b.id}`,
    appName: b.appName ?? null, sender: b.sender ?? null, title: v.maskedTitle ?? null,
    contentEnc: await deps.encrypt(user, v.masked),
    ocrTextEnc: ocr === null ? null : await deps.encrypt(user, ocr),
    occurredAt,
  });
  return Response.json({ item_id: itemId, duplicate: itemId === null }, { status: 202 });
}
