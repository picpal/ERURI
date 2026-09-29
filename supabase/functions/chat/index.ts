import { createClient } from "npm:@supabase/supabase-js@2";
import { SERVER_AUTH } from "../_shared/crypto.ts";
import { handleChat } from "./handler.ts";
import { hybridSearch, openaiAnswer } from "./deps.ts";

// 최소 구현(0단계 평가용). 실제 사용자 데이터의 청크 임베딩은 아직 없으므로(스펙 §16) 운영 배포는 1단계에서 한다
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, SERVER_AUTH);
Deno.serve((req) => handleChat(req, {
  authUser: async (token) => {
    const { data, error } = await sb.auth.getUser(token);
    return error ? null : data.user?.id ?? null;
  },
  search: hybridSearch(sb),
  answer: openaiAnswer,
  today: () => new Date().toISOString().slice(0, 10),
}));
