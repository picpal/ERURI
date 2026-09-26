import { createClient } from "npm:@supabase/supabase-js@2";
import { SERVER_AUTH } from "../_shared/crypto.ts";
import { handleWebhook, verifyPubSubToken } from "./handler.ts";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, SERVER_AUTH);
// audience는 push 구독에 설정한 값과 같아야 한다. 기본값 = 이 함수의 공개 URL
const AUDIENCE = Deno.env.get("PUBSUB_PUSH_AUDIENCE") ?? Deno.env.get("SUPABASE_URL") + "/functions/v1/gmail-webhook";
Deno.serve((req) => handleWebhook(req, {
  verify: (h) => verifyPubSubToken(h, { audience: AUDIENCE, email: Deno.env.get("PUBSUB_PUSH_SA_EMAIL") }),
  enqueue: async (emailAddress) => {
    const { data, error } = await sb.rpc("gmail_enqueue_for_account", { p_account_ref: emailAddress });
    if (error) throw new Error("gmail_enqueue_for_account " + error.code);   // 500 → Pub/Sub 재전송
    return data !== null;
  },
}));
