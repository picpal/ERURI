// Slack 수신 웹훅으로 합성 문구를 보낸다(PoC-1·3 실기기 재현: Slack 알림 → 알림 자동화 → CaptureIntent. PoC-5: --only push).
// 사용: cd poc/server && deno run --allow-net --allow-env --allow-read --env-file=.env scripts/send-phrases.ts [--only d02,d09|push] [--gap 25] [--dry-run]
// SLACK_WEBHOOK_URL 은 .env 에만 둔다(출력 금지)
import { parseSenderArgs, runSender } from "./_phrase-sender.ts";

const args = parseSenderArgs(Deno.args, 25);
const url = Deno.env.get("SLACK_WEBHOOK_URL");
if (!url && !args.dryRun) { console.error("SLACK_WEBHOOK_URL 없음 (.env)"); Deno.exit(2); }
const failures = await runSender(async (text) => {
  const r = await fetch(url!, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
  await r.body?.cancel();
  return { ok: r.ok, code: String(r.status) };
}, args);
Deno.exit(failures > 0 ? 1 : 0);
