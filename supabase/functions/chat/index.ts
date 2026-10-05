import { createClient } from "npm:@supabase/supabase-js@2";
import { SERVER_AUTH } from "../_shared/crypto.ts";
import { handleChat } from "./handler.ts";
import { chatDeps } from "./deps.ts";

// 채팅(스펙 §9) — POST /chat {question, context?}(≤3턴 짧은 맥락), POST /chat/item {item_id}(출처 원문, 본인만)
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, SERVER_AUTH);
const deps = chatDeps(sb);
Deno.serve((req) => handleChat(req, deps));
