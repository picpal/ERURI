import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { parseCapturedAt } from "./handler.ts";

// PoC 전용 추적 이벤트(실기기 세션 관찰값). POST /functions/v1/ingest/trace, 사용자 JWT 필수.
// body = [{ device_id, event, fields, at }] (1~200건). fields는 jsonb 그대로 두되 문자열은 200자에서 자르고,
// content·text·body 키는 어느 깊이에서든 거부한다(본문 유입 방지). 1단계에서 poc_traces와 함께 삭제한다
export const MAX_TRACES = 200;
const MAX_STRING = 200;
const MAX_FIELDS_BYTES = 4096;
const FORBIDDEN_KEYS = new Set(["content", "text", "body"]);
const EVENT = /^poc[0-9]+[a-z0-9_]*\.[a-z0-9_.]{1,60}$/;              // <poc>.<event>, 예: poc1.intent_fired, poc8_9.upload_done

export type TraceRow = { user_id: string; device_id: string; event: string; fields: Record<string, unknown>; at: string };
export type TraceDeps = {
  authUser(token: string): Promise<string | null>;
  insertTraces(userToken: string, rows: TraceRow[]): Promise<number>;   // 새로 들어간 행 수(중복 제외)
};

// 사용자 JWT 클라이언트로 넣는다(RLS). 같은 (user_id, device_id, event, at)는 무시한다(0015)
export async function upsertTraces(client: SupabaseClient, rows: TraceRow[]): Promise<number> {
  const { error, count } = await client.from("poc_traces")
    .upsert(rows, { onConflict: "user_id,device_id,event,at", ignoreDuplicates: true, count: "exact" });
  if (error) throw new Error("poc_traces insert " + error.code);
  return count ?? 0;
}

export function isTracePath(url: URL): boolean {
  return /\/ingest\/trace\/?$/.test(url.pathname);
}

class Bad extends Error { constructor(readonly code: string, readonly index?: number) { super(code); } }

function hasForbiddenKey(v: unknown): boolean {
  if (Array.isArray(v)) return v.some(hasForbiddenKey);
  if (v && typeof v === "object") {
    return Object.entries(v).some(([k, x]) => FORBIDDEN_KEYS.has(k.toLowerCase()) || hasForbiddenKey(x));
  }
  return false;
}
function truncate(v: unknown): unknown {
  if (typeof v === "string") return v.length > MAX_STRING ? v.slice(0, MAX_STRING) : v;
  if (Array.isArray(v)) return v.map(truncate);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, truncate(x)]));
  return v;
}

function toRow(user: string, e: unknown, i: number): TraceRow {
  if (!e || typeof e !== "object" || Array.isArray(e)) throw new Bad("bad_item", i);
  const o = e as Record<string, unknown>;
  if (typeof o.device_id !== "string" || o.device_id.length === 0 || o.device_id.length > 100) throw new Bad("bad_device_id", i);
  if (typeof o.event !== "string" || !EVENT.test(o.event)) throw new Bad("bad_event", i);
  const at = parseCapturedAt(o.at);
  if (!at) throw new Bad("bad_at", i);
  const raw = o.fields ?? {};
  if (typeof raw !== "object" || Array.isArray(raw) || raw === null) throw new Bad("bad_fields", i);
  if (hasForbiddenKey(raw)) throw new Bad("forbidden_field", i);
  const fields = truncate(raw) as Record<string, unknown>;
  if (new TextEncoder().encode(JSON.stringify(fields)).length > MAX_FIELDS_BYTES) throw new Bad("fields_too_large", i);
  return { user_id: user, device_id: o.device_id, event: o.event, fields, at };
}

export async function handleTrace(req: Request, deps: TraceDeps): Promise<Response> {
  const token = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const user = token ? await deps.authUser(token) : null;
  if (!user || !token) return new Response(null, { status: 401 });
  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ error: "bad_json" }, { status: 400 }); }
  let rows: TraceRow[];
  try {
    if (!Array.isArray(body)) throw new Bad("not_array");
    if (body.length === 0) throw new Bad("empty");
    if (body.length > MAX_TRACES) throw new Bad("too_many");
    rows = body.map((e, i) => toRow(user, e, i));
  } catch (e) {
    if (!(e instanceof Bad)) throw e;
    return Response.json({ error: e.code, ...(e.index === undefined ? {} : { index: e.index }) }, { status: 400 });
  }
  const inserted = await deps.insertTraces(token, rows);
  const duplicates = rows.length - inserted;
  console.log(JSON.stringify({ ingest: "trace", count: rows.length, duplicates }));   // 이벤트 내용은 남기지 않는다
  return Response.json({ inserted, duplicates }, { status: 202 });
}
