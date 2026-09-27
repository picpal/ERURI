import { createClient } from "npm:@supabase/supabase-js@2";
import { defaultApnsEnv, sendAPNs } from "../_shared/apns.ts";
import { isServiceCaller } from "../_shared/auth.ts";
import { SERVER_AUTH } from "../_shared/crypto.ts";
import { handleApnsSend } from "./handler.ts";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, SERVER_AUTH);
Deno.serve((req) => handleApnsSend(req, {
  isService: isServiceCaller,
  // service role 경로라 user_id를 명시해 조회한다(스펙 §12 통제 4)
  lookupDevice: async (deviceId, userId) => {
    const { data, error } = await sb.from("devices").select("apns_token, apns_env").eq("user_id", userId).eq("device_id", deviceId).maybeSingle();
    if (error) throw new Error("devices " + error.code);
    return data;
  },
  send: sendAPNs,
  defaultEnv: defaultApnsEnv,
  topic: () => Deno.env.get("APNS_TOPIC")!,
}));
