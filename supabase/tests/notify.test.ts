import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import type { APNsResult, ApnsEnv } from "../functions/_shared/apns.ts";
import { apnsP8 } from "../functions/_shared/apns.ts";
import type { Job } from "../functions/_shared/job.ts";
import { isPermanentFailure, planProposalPush, type ProposalRow, whenLabel } from "../functions/_shared/notify.ts";
import { type Device, notifyProposal, type NotifyDeps, type PushRecord } from "../functions/worker/notify.ts";

const NOW = new Date("2026-09-29T06:00:00Z");                  // 서울 15:00
const row = (o: Partial<ProposalRow> & { payload?: Record<string, unknown> } = {}): ProposalRow => ({ id: "p1", action: "create_event", status: "proposed", version: 1,
  occurred_at: "2026-09-29T05:00:00Z", captured_at: "2026-09-29T05:00:05Z",
  payload: { title: "합성 치과", start: "2026-10-02T15:30:00+09:00", end: null, location: null, uncertain: [] }, ...o });
const aps = (p: ReturnType<typeof planProposalPush>) => (p.skip === null ? p.payload.aps as { alert: { title: string; body: string }; category: string } : null);

Deno.test("whenLabel: Seoul wall clock with Korean weekday; date-only without time", () => {
  assertEquals(whenLabel("2026-10-02T15:30:00+09:00"), "10월 2일(금) 15:30");
  assertEquals(whenLabel("2026-10-02T06:30:00Z"), "10월 2일(금) 15:30");
  assertEquals(whenLabel("2026-10-24"), "10월 24일(토)");
});

Deno.test("plan: timed event without uncertain → ADD_EVENT with iOS contract keys (proposal_id, title, +09:00 start)", () => {
  const p = planProposalPush(row(), NOW);
  assertEquals(p.skip, null);
  if (p.skip !== null) return;
  assertEquals([p.category, aps(p)!.category, aps(p)!.alert.title, aps(p)!.alert.body], ["ADD_EVENT", "ADD_EVENT", "일정 제안", "10월 2일(금) 15:30 · 합성 치과"]);
  assertEquals([p.payload.proposal_id, p.payload.version, p.payload.title, p.payload.start], ["p1", 1, "합성 치과", "2026-10-02T15:30:00+09:00"]);
});

// Review Focus 2: 날짜만·uncertain 일정은 버튼 없는 REVIEW
Deno.test("plan: date-only or uncertain event → REVIEW", () => {
  const d = planProposalPush(row({ payload: { title: "합성 행사", start: "2026-10-24", uncertain: [] } }), NOW);
  assertEquals([d.skip === null && d.category, aps(d)!.alert.title, aps(d)!.alert.body], ["REVIEW", "일정 확인 필요", "10월 24일(토) · 합성 행사"]);
  const u = planProposalPush(row({ payload: { title: "합성", start: "2026-10-02T15:30:00+09:00", uncertain: ["ampm"] } }), NOW);
  assertEquals(u.skip === null && u.category, "REVIEW");
});

// Review Focus 3: 백필·지난 일정·지난 기한은 푸시 안 함
Deno.test("plan: backfill (≥3 days old at capture), past start/due, non-proposed → skip", () => {
  assertEquals(planProposalPush(row({ occurred_at: "2026-09-20T00:00:00Z", captured_at: "2026-09-29T05:00:00Z" }), NOW).skip, "backfill");
  assertEquals(planProposalPush(row({ occurred_at: null }), NOW).skip, null);
  assertEquals(planProposalPush(row({ payload: { title: "x", start: "2026-09-29T14:00:00+09:00", uncertain: [] } }), NOW).skip, "past");
  assertEquals(planProposalPush(row({ payload: { title: "x", start: "2026-09-29", uncertain: [] } }), NOW).skip, null);   // 오늘은 지나지 않음
  assertEquals(planProposalPush(row({ payload: { title: "x", start: "2026-09-28", uncertain: [] } }), NOW).skip, "past");
  assertEquals(planProposalPush(row({ action: "create_reminder", payload: { title: "납부", due: "2026-09-28", uncertain: [] } }), NOW).skip, "past");
  assertEquals(planProposalPush(row({ status: "stale" }), NOW).skip, "not_proposed");
  assertEquals(planProposalPush(row({ action: "update_event" }), NOW).skip, "unsupported");
  assertEquals(planProposalPush(row({ payload: { title: "x", start: null } }), NOW).skip, "unsupported");
});

Deno.test("plan: reminder → ADD_REMINDER with due; titles clipped to 40 with ellipsis; missing title → 일정", () => {
  const r = planProposalPush(row({ action: "create_reminder", payload: { title: "합성 납부", due: "2026-10-04", uncertain: [] } }), NOW);
  assertEquals([r.skip === null && r.category, aps(r)!.alert.body, r.skip === null && r.payload.due], ["ADD_REMINDER", "합성 납부 · 10월 4일(일)까지", "2026-10-04"]);
  const long = planProposalPush(row({ payload: { title: "가".repeat(50), start: "2026-10-02T15:30:00+09:00", uncertain: [] } }), NOW);
  assertEquals((long.skip === null ? long.payload.title as string : "").length, 40);
  assert((long.skip === null ? long.payload.title as string : "").endsWith("…"));
  const none = planProposalPush(row({ payload: { title: null, start: "2026-10-02T15:30:00+09:00", uncertain: [] } }), NOW);
  assertEquals(none.skip === null && none.payload.title, "일정");
});

Deno.test("isPermanentFailure: 400/403/404/410/413 permanent; 429/5xx transient", () => {
  for (const s of [400, 403, 404, 410, 413]) assert(isPermanentFailure({ status: s }));
  for (const s of [429, 500, 503]) assert(!isPermanentFailure({ status: s }));
});

Deno.test("apnsP8: inline APNS_P8 wins, else APNS_P8_PATH file, else coded error", () => {
  assertEquals(apnsP8((k) => ({ APNS_P8: "inline", APNS_P8_PATH: "x" } as Record<string, string>)[k], () => "file"), "inline");
  assertEquals(apnsP8((k) => ({ APNS_P8_PATH: "keys/a.p8" } as Record<string, string>)[k], (p) => `file:${p}`), "file:keys/a.p8");
  assertThrows(() => apnsP8(() => undefined, () => ""), Error, "apns p8_missing");
});

// ── notify 잡: 가짜 기기·발송 ──
const TOK = (c: string) => c.repeat(64);
function deps(o: { proposal?: ProposalRow | null; devices?: Device[]; claimed?: Set<string>; inFlight?: Set<string>;
  reply?: (token: string, env: ApnsEnv) => APNsResult | Error } = {}) {
  const calls = { sent: [] as [string, ApnsEnv, unknown][], finished: [] as [string, PushRecord][], listed: 0 };
  const d: NotifyDeps = {
    getProposal: async () => (o.proposal === undefined ? row() : o.proposal),
    listDevices: async () => { calls.listed++; return o.devices ?? [{ device_id: "d1", apns_token: TOK("a"), apns_env: "production" }]; },
    claimPush: async (_u, _p, dev) => (o.claimed?.has(dev) ? "closed" : o.inFlight?.has(dev) ? "in_flight" : "claimed"),
    finishPush: async (_u, _p, dev, r) => { calls.finished.push([dev, r]); },
    send: async (x) => { calls.sent.push([x.token, x.env, x.payload]); const r = o.reply?.(x.token, x.env) ?? { status: 200, apnsId: "id-1" };
      if (r instanceof Error) throw r; return r; },
    topic: () => "com.picpal.eruri",
    now: () => NOW,
  };
  return { d, calls };
}
const job = (o: Partial<Job> = {}): Job => ({ id: "j1", kind: "notify", user_id: "u1", payload: { proposal_id: "p1" }, attempts: 1, checkpoint: null, ...o });

Deno.test("notify: sends the planned payload to each device once and records sent", async () => {
  const devices: Device[] = [{ device_id: "d1", apns_token: TOK("a"), apns_env: "production" }, { device_id: "d2", apns_token: TOK("b"), apns_env: "sandbox" }];
  const { d, calls } = deps({ devices });
  assertEquals(await notifyProposal(d, job()), "notified");
  assertEquals(calls.sent.map(([t, e]) => [t[0], e]), [["a", "production"], ["b", "sandbox"]]);
  assertEquals((calls.sent[0][2] as { aps: { category: string } }).aps.category, "ADD_EVENT");
  assertEquals(calls.finished.map(([dev, r]) => [dev, r.status, r.apnsId]), [["d1", "sent", "id-1"], ["d2", "sent", "id-1"]]);
});

Deno.test("notify: already claimed device is skipped (one push per proposal per device)", async () => {
  const devices: Device[] = [{ device_id: "d1", apns_token: TOK("a"), apns_env: "production" }, { device_id: "d2", apns_token: TOK("b"), apns_env: "production" }];
  const { d, calls } = deps({ devices, claimed: new Set(["d1"]) });
  await notifyProposal(d, job());
  assertEquals(calls.sent.map(([t]) => t[0]), ["b"]);
});

// Fix round 1: 임대 안의 sending(다른 시도가 보내는 중이거나 막 죽음)을 '이미 보냄'으로 치고 성공하면 그 기기는 영영 못 받는다
Deno.test("notify: in-flight device → not sent now, other devices sent, job throws so a later attempt retries it", async () => {
  const devices: Device[] = [{ device_id: "d1", apns_token: TOK("a"), apns_env: "production" }, { device_id: "d2", apns_token: TOK("b"), apns_env: "production" }];
  const { d, calls } = deps({ devices, inFlight: new Set(["d1"]) });
  await assertRejects(() => notifyProposal(d, job()), Error, "notify transient failed=0 in_flight=1");
  assertEquals([calls.sent.map(([t]) => t[0]), calls.finished.map(([dev]) => dev)], [["b"], ["d2"]]);
});

// Review Focus 5: 영구 오류 토큰은 rejected, 재시도 없음, 다른 기기는 계속
Deno.test("notify: permanent failure (410 / BadDeviceToken both envs) → rejected, job succeeds, other device still sent", async () => {
  const devices: Device[] = [{ device_id: "old", apns_token: TOK("a"), apns_env: "production" }, { device_id: "bad", apns_token: TOK("c"), apns_env: "production" },
    { device_id: "ok", apns_token: TOK("b"), apns_env: "production" }];
  const { d, calls } = deps({ devices, reply: (t) => t[0] === "a" ? { status: 410, reason: "Unregistered" } : t[0] === "c" ? { status: 400, reason: "BadDeviceToken" } : { status: 200 } });
  assertEquals(await notifyProposal(d, job()), "notified");
  assertEquals(calls.finished.map(([dev, r]) => [dev, r.status, r.reason]), [["old", "rejected", "Unregistered"], ["bad", "rejected", "BadDeviceToken"], ["ok", "sent", null]]);
  assertEquals(calls.sent.filter(([t]) => t[0] === "c").map(([, e]) => e), ["production", "sandbox"]);   // 환경 불일치 1회 재시도
});

Deno.test("notify: transient failure (503 or connection error) → failed recorded, job throws for retry", async () => {
  const a = deps({ reply: () => ({ status: 503, reason: "ServiceUnavailable" }) });
  await assertRejects(() => notifyProposal(a.d, job()), Error, "notify transient failed=1 in_flight=0");
  assertEquals(a.calls.finished[0][1].status, "failed");
  const b = deps({ reply: () => new Error("http2 GOAWAY") });
  await assertRejects(() => notifyProposal(b.d, job()), Error, "notify transient failed=1 in_flight=0");
  assertEquals([b.calls.finished[0][1].status, b.calls.finished[0][1].reason], ["failed", "network"]);
});

Deno.test("notify: skip plans never list devices; not found → skipped; no devices → no_device; no user → error", async () => {
  const past = deps({ proposal: row({ payload: { title: "x", start: "2026-09-01T10:00:00+09:00", uncertain: [] } }) });
  assertEquals([await notifyProposal(past.d, job()), past.calls.listed], ["skipped", 0]);
  assertEquals(await notifyProposal(deps({ proposal: null }).d, job()), "skipped");
  assertEquals(await notifyProposal(deps({ devices: [] }).d, job()), "no_device");
  await assertRejects(() => notifyProposal(deps().d, job({ user_id: null })), Error, "notify job without user_id");
});

Deno.test("plan: every pushed payload carries the proposal version (§10 순서 5)", () => {
  const now = new Date("2026-10-01T00:00:00Z");
  const base = { id: "p1", status: "proposed", version: 3, occurred_at: "2026-09-30T23:00:00Z", captured_at: "2026-09-30T23:00:05Z" };
  const ev = planProposalPush({ ...base, action: "create_event", payload: { title: "합성 진료", start: "2026-10-03T15:00:00+09:00", uncertain: [] } }, now);
  const task = planProposalPush({ ...base, action: "create_reminder", payload: { title: "합성 납부", due: "2026-10-05" } }, now);
  assertEquals([ev.skip === null ? ev.payload.version : null, task.skip === null ? task.payload.version : null], [3, 3]);
});
