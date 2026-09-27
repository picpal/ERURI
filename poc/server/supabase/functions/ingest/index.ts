import { createClient } from "npm:@supabase/supabase-js@2";
import { encrypt, SERVER_AUTH, toBytea } from "../_shared/crypto.ts";
import { handleIngest } from "./handler.ts";
import { handleTrace, isTracePath } from "./trace.ts";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, SERVER_AUTH);
const authUser = async (token: string) => {
  const { data, error } = await sb.auth.getUser(token);
  return error ? null : data.user?.id ?? null;
};
Deno.serve((req) => {
  // POST /functions/v1/ingest/trace: PoC 추적 이벤트(poc_traces). 사용자 JWT 클라이언트로 넣어 RLS를 그대로 적용한다
  if (isTracePath(new URL(req.url))) {
    return handleTrace(req, {
      authUser,
      insertTraces: async (userToken, rows) => {
        const userDb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
          { ...SERVER_AUTH, global: { headers: { Authorization: `Bearer ${userToken}` } } });
        const { error } = await userDb.from("poc_traces").insert(rows);
        if (error) throw new Error("poc_traces insert " + error.code);
      },
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
      });
      if (error) throw new Error("insert_item " + error.code);
      return data as string | null;
    },
  });
});
