import { createClient } from "npm:@supabase/supabase-js@2";
import { encrypt, SERVER_AUTH, toBytea } from "../_shared/crypto.ts";
import { kickInBackground } from "../_shared/kick-worker.ts";
import { handleIngest } from "./handler.ts";
import { handleDevice, isDevicePath } from "./device.ts";
import { handleTrace, isTracePath, touchDevices, upsertTraces } from "./trace.ts";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, SERVER_AUTH);
// 사용자 JWT로 만든 클라이언트: RLS를 그대로 적용한다
const userDb = (userToken: string) => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
  { ...SERVER_AUTH, global: { headers: { Authorization: `Bearer ${userToken}` } } });
const authUser = async (token: string) => {
  const { data, error } = await sb.auth.getUser(token);
  return error ? null : data.user?.id ?? null;
};
Deno.serve((req) => {
  const url = new URL(req.url);
  // POST /functions/v1/ingest/device: 기기 APNs 토큰·환경 등록(devices)
  if (isDevicePath(url)) {
    return handleDevice(req, {
      authUser,
      upsertDevice: async (userToken, row) => {
        const { error } = await userDb(userToken).from("devices").upsert(row, { onConflict: "user_id,device_id" });
        if (error) throw new Error("devices upsert " + error.code);
      },
    });
  }
  // POST /functions/v1/ingest/trace: 진단 trace(device_traces). 사용자 JWT 클라이언트로 넣어 RLS를 그대로 적용한다
  if (isTracePath(url)) {
    return handleTrace(req, {
      authUser,
      insertTraces: (userToken, rows) => upsertTraces(userDb(userToken), rows),
      touchDevices: (userToken, ids) => touchDevices(userDb(userToken), ids),
    });
  }
  return handleIngest(req, {
    authUser,
    encrypt,
    insertItem: async (a) => {
      const { data, error } = await sb.rpc("insert_item", {
        p_user: a.user, p_source: a.source, p_idempotency_key: a.idempotencyKey, p_sender: a.sender, p_title: a.title,
        p_content_enc: toBytea(a.contentEnc), p_occurred_at: a.occurredAt,
        p_app_name: a.appName, p_ocr_text_enc: a.ocrTextEnc ? toBytea(a.ocrTextEnc) : null,
        p_device_filter: a.deviceFilter,
      });
      if (error) throw new Error("insert_item " + error.code);
      return data as string | null;
    },
    // service role 경로라 user_id 를 명시해 조회한다(스펙 §12 통제 4). id 만 읽는다
    findItem: async (user, key) => {
      const { data, error } = await sb.from("items").select("id").eq("user_id", user).eq("idempotency_key", key).maybeSingle();
      if (error) throw new Error("items lookup " + error.code);
      return data?.id ?? null;
    },
    kick: () => { kickInBackground(); },
  });
});
