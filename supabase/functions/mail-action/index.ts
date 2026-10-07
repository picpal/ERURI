import { createClient } from "npm:@supabase/supabase-js@2";
import { SERVER_AUTH } from "../_shared/crypto.ts";
import { mailActionDeps } from "./deps.ts";
import { handleMailAction } from "./handler.ts";

// 메일 정리(스펙 §7). 사용자 JWT 함수(config.toml 기본 verify_jwt = true). service role 키는 RPC 에만 쓴다
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, SERVER_AUTH);
const deps = mailActionDeps(sb);
Deno.serve((req) => handleMailAction(req, deps));
