// 광고 구독 해지 실측 집계(계획 U6b·U10). 개인정보(AGENTS.md §7): 개수·방법·상태·결과 코드만 출력한다(주소·이름·URL·도메인 없음).
// 집계는 서버 RPC unsub_stats(행 상한 없음, 리뷰 M8). --since <ISO> 면 그 뒤에 만든 스캔 잡만 센다(이번 스캔 대조)
// 사용: deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/unsub-stats.ts [--enqueue-scan] [--since <ISO>]
import { createClient } from "npm:@supabase/supabase-js@2";
import { SERVER_AUTH } from "../functions/_shared/crypto.ts";

const user = Deno.env.get("ERURI_USER_ID");
if (!user) { console.error("ERURI_USER_ID 없음"); Deno.exit(2); }
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, SERVER_AUTH);
let since = Deno.args.includes("--since") ? Deno.args[Deno.args.indexOf("--since") + 1] : null;
if (since && Number.isNaN(Date.parse(since))) throw new Error("bad --since");
if (Deno.args.includes("--enqueue-scan")) {
  since ??= new Date(Date.now() - 60_000).toISOString();
  const { data, error } = await sb.rpc("gmail_enqueue_unsub_scan", { p_user: user });
  if (error) throw new Error("enqueue " + error.code);
  console.log(JSON.stringify({ enqueued: data, since }));
}
const { data, error } = await sb.rpc("unsub_stats", { p_user: user, p_jobs_since: since });
if (error) throw new Error("unsub_stats " + error.code);
console.log(JSON.stringify(data));
