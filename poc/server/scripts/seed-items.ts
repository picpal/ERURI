import { createClient } from "npm:@supabase/supabase-js@2";
import { encrypt, SERVER_AUTH, toBytea } from "../supabase/functions/_shared/crypto.ts";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, SERVER_AUTH);
const user = Deno.env.get("POC_USER_ID")!;
const n = Number(Deno.args[0] ?? 20);
for (let i = 0; i < n; i++) {
  const text = `합성 주문 확인 #${i}: 무선 이어폰 1개, 결제 39,000원, 배송 예정 10월 2일. `.repeat(50);   // 약 5KB
  const { error } = await sb.rpc("insert_item", { p_user: user, p_source: "SHARE", p_idempotency_key: `seed:${crypto.randomUUID()}`,
    p_sender: null, p_title: `seed ${i}`, p_content_enc: toBytea(await encrypt(user, text)), p_occurred_at: new Date().toISOString() });
  if (error) throw new Error("insert_item " + error.code);
}
console.log(`seeded ${n}`);
