import { assertEquals } from "jsr:@std/assert";
import type { APNsResult } from "../functions/_shared/apns.ts";
import { encrypt, toBytea } from "../functions/_shared/crypto.ts";
import { eventFact, saveFact } from "../functions/_shared/facts.ts";
import { notifyProposal } from "../functions/worker/notify.ts";
import { notifyDeps } from "../functions/worker/notify-deps.ts";
import { RUN, service as sb, testUser } from "./_testenv.ts";

// 호스팅 DB. 전용 테스트 사용자·실행 태그(device_id 접두)만. APNs 는 가짜(실제 발송 없음)
const USER = (await testUser()).id;
const DEV = `${RUN}:d1`;
async function seedProposal(tag: string): Promise<{ item: string; proposal: string }> {
  const { data: item } = await sb.rpc("insert_item", { p_user: USER, p_source: "NOTIFICATION", p_idempotency_key: `${RUN}:push:${tag}`,
    p_sender: null, p_title: null, p_content_enc: toBytea(await encrypt(USER, "합성 알림")), p_occurred_at: new Date().toISOString(), p_enqueue: false });
  const s = await saveFact(sb, eventFact(USER, item as string, { title: "합성 치과", start: "2026-10-02T15:30:00+09:00", end: null, location: null, uncertain: [] }, "text"));
  return { item: item as string, proposal: s.proposalId! };
}
async function cleanup(items: string[]) {
  await sb.from("devices").delete().eq("user_id", USER).like("device_id", `${RUN}%`);
  await sb.from("facts").delete().eq("user_id", USER).in("item_id", items);   // proposals → proposal_pushes cascade
  await sb.from("items").delete().eq("user_id", USER).in("id", items);
}

Deno.test("claim/finish: one claim wins; sent/rejected stay closed; failed and stale sending reopen; other user's proposal refused", async () => {
  const { item, proposal } = await seedProposal("claim");
  const other = (await testUser(2)).id;
  const claim = () => sb.rpc("claim_proposal_push", { p_user: USER, p_proposal: proposal, p_device: DEV });
  const finish = (st: string) => sb.rpc("finish_proposal_push", { p_user: USER, p_proposal: proposal, p_device: DEV, p_status: st,
    p_apns_status: null, p_reason: null, p_apns_id: null, p_env: null });
  try {
    const [a, b] = await Promise.all([claim(), claim()]);
    assertEquals([a.data, b.data].sort(), [false, true]);
    await finish("failed");
    assertEquals((await claim()).data, true);
    await finish("sent");
    assertEquals((await claim()).data, false);
    await sb.from("proposal_pushes").update({ status: "sending", claimed_at: new Date(Date.now() - 6 * 60_000).toISOString() })
      .eq("proposal_id", proposal).eq("device_id", DEV);
    assertEquals((await claim()).data, true);
    await finish("rejected");
    assertEquals((await claim()).data, false);
    const theirs = await sb.rpc("claim_proposal_push", { p_user: other, p_proposal: proposal, p_device: DEV });
    assertEquals(theirs.error !== null, true);
  } finally { await cleanup([item]); }
});

Deno.test("notify job on hosted DB: sends once to the test device, second run sends nothing", async () => {
  const { item, proposal } = await seedProposal("job");
  await sb.from("devices").insert({ user_id: USER, device_id: DEV, apns_token: "a".repeat(64), apns_env: "production" });
  const sent: string[] = [];
  const deps = notifyDeps(sb, { send: async (o): Promise<APNsResult> => { sent.push(o.token.slice(0, 1)); return { status: 200, apnsId: "t-1" }; },
    topic: () => "com.picpal.assistant.poc", now: () => new Date("2026-09-29T06:00:00Z") });
  const job = { id: `${RUN}:notify`, kind: "notify", user_id: USER, payload: { proposal_id: proposal }, attempts: 1, checkpoint: null };
  try {
    const p = await deps.getProposal(USER, proposal);
    assertEquals([p?.action, p?.status, p?.occurred_at !== null], ["create_event", "proposed", true]);
    assertEquals(await deps.getProposal((await testUser(2)).id, proposal), null);
    assertEquals(await notifyProposal(deps, job), "notified");
    await notifyProposal(deps, job);
    assertEquals(sent.length, (await deps.listDevices(USER)).length);                 // 테스트 사용자 기기마다 1번
    const { data } = await sb.from("proposal_pushes").select("status, apns_status, apns_id").eq("proposal_id", proposal).eq("device_id", DEV).single();
    assertEquals([data!.status, data!.apns_status, data!.apns_id], ["sent", 200, "t-1"]);
  } finally { await cleanup([item]); }
});
