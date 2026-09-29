// 스펙 §9 평가 절차 4: 앱 채팅 인용 👍/👎(eval_judgments) 집계만 읽는다(본문 없음). 기준: 답변 20건 이상의 인용 판정, 👍 비율을 PoC-7(인용 정밀도 39/39)과 비교
// 사용: deno run --allow-net --allow-env --allow-read --env-file=supabase/.env supabase/scripts/eval-judgments.ts [--since <ISO>] [--user <uuid>]
import { createClient } from "npm:@supabase/supabase-js@2";
import { SERVER_AUTH } from "../functions/_shared/crypto.ts";

const arg = (k: string) => { const i = Deno.args.indexOf(k); return i >= 0 ? Deno.args[i + 1] : undefined; };
const user = arg("--user") ?? Deno.env.get("ERURI_USER_ID");
const since = arg("--since") ?? "1970-01-01T00:00:00Z";
if (!user) { console.error("ERURI_USER_ID 없음"); Deno.exit(2); }
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, SERVER_AUTH);
const { data, error } = await sb.from("eval_judgments").select("question_id, ok").eq("user_id", user).gte("at", since);
if (error) throw new Error("eval_judgments " + error.code);
const answers = new Set(data.map((r) => r.question_id)).size, ok = data.filter((r) => r.ok).length;
console.log(JSON.stringify({ answers_judged: answers, citations: data.length, ok, precision: data.length ? Math.round((ok / data.length) * 1000) / 1000 : null,
  enough: answers >= 20 }));
