import { createClient } from "npm:@supabase/supabase-js@2";
import { encrypt, SERVER_AUTH, toBytea } from "../_shared/crypto.ts";
import { handleIngest } from "./handler.ts";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, SERVER_AUTH);
Deno.serve((req) => handleIngest(req, {
  authUser: async (token) => {
    const { data, error } = await sb.auth.getUser(token);
    return error ? null : data.user?.id ?? null;
  },
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
}));
