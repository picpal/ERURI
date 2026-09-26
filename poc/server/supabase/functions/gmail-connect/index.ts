import { createClient } from "npm:@supabase/supabase-js@2";
import { SERVER_AUTH } from "../_shared/crypto.ts";
import { exchangeCode, gmailApi } from "../_shared/gmail.ts";
import { handleConnect } from "./handler.ts";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, SERVER_AUTH);
Deno.serve((req) => handleConnect(req, {
  authUser: async (token) => {
    const { data, error } = await sb.auth.getUser(token);
    return error ? null : data.user?.id ?? null;
  },
  exchange: exchangeCode,
  api: gmailApi,
  rpc: sb,
  topic: () => Deno.env.get("GMAIL_PUBSUB_TOPIC")!,
}));
