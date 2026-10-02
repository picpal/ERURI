import { createClient } from "npm:@supabase/supabase-js@2";
import { SERVER_AUTH } from "../_shared/crypto.ts";
import { resolverKind } from "../_shared/safe-post.ts";
import { unsubDeps } from "./deps.ts";
import { handleUnsubscribe } from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const sb = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, SERVER_AUTH);
const key = Deno.env.get("UNSUB_SINK_KEY") ?? "";                                  // 없으면 sink 닫힘(404)
const sink = key ? { base: url.replace(/\/+$/, "") + "/functions/v1/unsubscribe/sink", key } : null;
console.log(JSON.stringify({ unsubscribe: "boot", resolver: resolverKind(), sink: !!sink }));   // 배포 실측(U6a): deno 또는 doh. 키 값은 찍지 않는다
Deno.serve((req) => handleUnsubscribe(req, unsubDeps(sb), sink));
