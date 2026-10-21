import { createClient } from "npm:@supabase/supabase-js@2";
import { SERVER_AUTH } from "../_shared/crypto.ts";
import { handleChat } from "./handler.ts";
import { chatDeps } from "./deps.ts";

// 채팅(스펙 §9) — POST /chat {question, context?, intents?, edit_target?, aggregate_context?}(≤3턴 짧은 맥락, 처리하는 행동 목록, 고칠 제안, 직전 집계 조건),
// POST /chat/item {item_id}(출처 원문, 본인만), POST /chat/aggregate {conditions, bucket_key}(집계 칸 목록), POST /chat/rule {op, …}(저장 규칙 카드 버튼)
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, SERVER_AUTH);
const deps = chatDeps(sb);
Deno.serve((req) => handleChat(req, deps));
