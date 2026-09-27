import { createClient } from "npm:@supabase/supabase-js@2";
import { isServiceCaller } from "../_shared/auth.ts";
import { SERVER_AUTH } from "../_shared/crypto.ts";
import { extractEventDetailed } from "../_shared/extract.ts";
import { handleVisionExtract } from "./handler.ts";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, SERVER_AUTH);
Deno.serve((req) => handleVisionExtract(req, {
  isServiceCaller,
  async download(bucket, path) {
    const { data, error } = await sb.storage.from(bucket).download(path);
    if (error || !data) throw new Error("storage download failed");
    return new Uint8Array(await data.arrayBuffer());
  },
  extract: (input) => extractEventDetailed(input),
}));
