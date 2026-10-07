import { createClient } from "npm:@supabase/supabase-js@2";
import { SERVER_AUTH } from "../_shared/crypto.ts";
import { mailReadDeps } from "./deps.ts";
import { handleMailRead } from "./handler.ts";

// 메일 요약(스펙 §7) — POST /mail-read/search·/mail-read/read. 사용자 JWT 함수(config.toml 기본 verify_jwt = true). service role 키는 RPC 에만 쓴다
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, SERVER_AUTH);
const deps = mailReadDeps(sb);
Deno.serve((req) => handleMailRead(req, deps));
