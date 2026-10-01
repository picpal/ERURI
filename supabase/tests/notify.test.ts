import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import type { APNsResult, ApnsEnv } from "../functions/_shared/apns.ts";
import { apnsP8 } from "../functions/_shared/apns.ts";
import type { Job } from "../functions/_shared/job.ts";
import { BUNDLE_CATEGORY, isPermanentFailure, type PeerProposal, planBundlePush, planProposalPush, type ProposalRow, titleKey, whenLabel } from "../functions/_shared/notify.ts";
import { type Device, notifyProposal, type NotifyDeps, type PushRecord } from "../functions/worker/notify.ts";

const NOW = new Date("2026-09-29T06:00:00Z");                  // 서울 15:00
const row = (o: Partial<ProposalRow> & { payload?: Record<string, unknown> } = {}): ProposalRow => ({ id: "p1", action: "create_event", status: "proposed", version: 1,
  occurred_at: "2026-09-29T05:00:00Z", captured_at: "2026-09-29T05:00:05Z",
  payload: { title: "합성 치과", start: "2026-10-02T15:30:00+09:00", end: null, location: null, uncertain: [] }, ...o });
const ev = (id: string, start: string, o: Partial<ProposalRow> & { title?: string; uncertain?: string[] } = {}) =>
  row({ id, ...o, payload: { title: o.title ?? `합성 ${id}`, start, end: null, location: null, uncertain: o.uncertain ?? [] } });
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

// Review Focus 2: uncertain 일정은 버튼 없는 REVIEW. 날짜만(uncertain 없음)은 종일 일정으로 ADD_EVENT(0.9.1, 2026-10-01 사용자 결정 A)
Deno.test("plan: uncertain event → REVIEW (timed or date-only)", () => {
  const u = planProposalPush(row({ payload: { title: "합성", start: "2026-10-02T15:30:00+09:00", uncertain: ["ampm"] } }), NOW);
  assertEquals(u.skip === null && u.category, "REVIEW");
  const d = planProposalPush(row({ payload: { title: "합성 행사", start: "2026-10-24", uncertain: ["year"] } }), NOW);
  assertEquals([d.skip === null && d.category, aps(d)!.alert.title, aps(d)!.alert.body], ["REVIEW", "일정 확인 필요", "10월 24일(토) · 합성 행사"]);
});

Deno.test("plan: date-only event without uncertain → ADD_EVENT all-day; start stays YYYY-MM-DD, no end key for one day", () => {
  const d = planProposalPush(row({ payload: { title: "합성 행사", start: "2026-10-24", end: null, uncertain: [] } }), NOW);
  assertEquals([d.skip === null && d.category, aps(d)!.category, aps(d)!.alert.title, aps(d)!.alert.body],
    ["ADD_EVENT", "ADD_EVENT", "일정 제안", "10월 24일(토) · 합성 행사"]);
  assertEquals(d.skip === null && d.payload.start, "2026-10-24");
  assertEquals(d.skip === null && "end" in d.payload, false);
  const same = planProposalPush(row({ payload: { title: "합성 행사", start: "2026-10-24", end: "2026-10-24", uncertain: [] } }), NOW);
  assertEquals(same.skip === null && "end" in same.payload, false);
  // 오늘(서울)은 지나지 않은 것으로 본다(종일)
  assertEquals(planProposalPush(row({ payload: { title: "합성", start: "2026-09-29", uncertain: [] } }), NOW).skip, null);
});

Deno.test("plan: date-only multi-day → end is the last day (YYYY-MM-DD, Seoul) when after start; timed end stays out of the payload", () => {
  const span = planProposalPush(row({ payload: { title: "합성 축제", start: "2026-10-24", end: "2026-10-26", uncertain: [] } }), NOW);
  assertEquals(span.skip === null && span.payload.end, "2026-10-26");
  const timedEnd = planProposalPush(row({ payload: { title: "합성 축제", start: "2026-10-24", end: "2026-10-25T18:00:00+09:00", uncertain: [] } }), NOW);
  assertEquals(timedEnd.skip === null && timedEnd.payload.end, "2026-10-25");
  const before = planProposalPush(row({ payload: { title: "합성 축제", start: "2026-10-24", end: "2026-10-20", uncertain: [] } }), NOW);
  assertEquals(before.skip === null && "end" in before.payload, false);
  const timed = planProposalPush(row({ payload: { title: "합성 치과", start: "2026-10-02T15:30:00+09:00", end: "2026-10-02T16:30:00+09:00", uncertain: [] } }), NOW);
  assertEquals(timed.skip === null && "end" in timed.payload, false);           // 시각 있는 일정은 지금처럼 1시간(§10)
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
function deps(o: { proposal?: ProposalRow | null; bundle?: ProposalRow[]; devices?: Device[]; claimed?: Set<string>; inFlight?: Set<string>;
  reply?: (token: string, env: ApnsEnv) => APNsResult | Error; peers?: PeerProposal[] | Error } = {}) {
  const calls = { sent: [] as [string, ApnsEnv, unknown][], finished: [] as [string, PushRecord][], listed: 0 };
  const d: NotifyDeps = {
    getProposal: async () => (o.proposal === undefined ? row() : o.proposal),
    getBundle: async () => (o.bundle ?? (o.proposal === null ? [] : [o.proposal === undefined ? row() : o.proposal])),
    getPeers: async () => { if (o.peers instanceof Error) throw o.peers; return o.peers ?? []; },
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

Deno.test("bundle: one pushable → the existing single payload for that proposal", () => {
  assertEquals(planBundlePush([ev("p1", "2026-10-02T15:30:00+09:00")], NOW), planProposalPush(ev("p1", "2026-10-02T15:30:00+09:00"), NOW));
});

Deno.test("bundle: two or more → EVENT_BUNDLE, earliest first, title/body counts, events carry per-event category", () => {
  const p = planBundlePush([ev("p1", "2026-10-11T14:00:00+09:00"), ev("p2", "2026-10-04T14:00:00+09:00"), ev("p3", "2026-10-23")], NOW);
  assertEquals(p.skip, null);
  if (p.skip !== null) return;
  assertEquals([p.category, aps(p)!.category, aps(p)!.alert.title, aps(p)!.alert.body],
    [BUNDLE_CATEGORY, "EVENT_BUNDLE", "일정 제안 3건", "10월 4일(일) 14:00 · 합성 p2 외 2건"]);
  assertEquals([p.payload.proposal_id, p.payload.start], ["p2", "2026-10-04T14:00:00+09:00"]);   // 입력 순서(순번)가 시작 순이 아니어도 시작 순
  assertEquals(p.payload.events, [
    { proposal_id: "p2", version: 1, title: "합성 p2", start: "2026-10-04T14:00:00+09:00", category: "ADD_EVENT" },
    { proposal_id: "p1", version: 1, title: "합성 p1", start: "2026-10-11T14:00:00+09:00", category: "ADD_EVENT" },
    { proposal_id: "p3", version: 1, title: "합성 p3", start: "2026-10-23", category: "ADD_EVENT" },   // 날짜만 = 종일(0.9.1)
  ]);
});

Deno.test("bundle: date-only events sort as Seoul midnight; a multi-day one carries its end date, uncertain stays REVIEW", () => {
  const span = row({ id: "p2", payload: { title: "합성 축제", start: "2026-10-04", end: "2026-10-06", uncertain: [] } });
  const p = planBundlePush([ev("p1", "2026-10-04T09:00:00+09:00"), span, ev("p3", "2026-10-05", { uncertain: ["date"] })], NOW);
  assert(p.skip === null);
  if (p.skip !== null) return;
  assertEquals(p.payload.events, [
    { proposal_id: "p2", version: 1, title: "합성 축제", start: "2026-10-04", end: "2026-10-06", category: "ADD_EVENT" },
    { proposal_id: "p1", version: 1, title: "합성 p1", start: "2026-10-04T09:00:00+09:00", category: "ADD_EVENT" },
    { proposal_id: "p3", version: 1, title: "합성 p3", start: "2026-10-05", category: "REVIEW" },
  ]);
  assertEquals(aps(p)!.alert.body, "10월 4일(일) · 합성 축제 외 2건");
});

// Review Focus 3: 지난 일정·무시한 제안은 빠지고, 하나만 남으면 단건(그 제안의 ADD_EVENT)
Deno.test("bundle: past lead and dismissed siblings drop out; one left → single ADD_EVENT; none left → lead's skip", () => {
  const past = ev("p1", "2026-09-29T09:00:00+09:00");
  const one = planBundlePush([past, ev("p2", "2026-10-11T14:00:00+09:00"), ev("p3", "2026-10-12T14:00:00+09:00", { status: "dismissed" })], NOW);
  assertEquals([one.skip === null && one.category, one.skip === null && one.payload.proposal_id], ["ADD_EVENT", "p2"]);
  assertEquals(planBundlePush([past, ev("p2", "2026-09-28")], NOW).skip, "past");
  const bf = { occurred_at: "2026-09-20T00:00:00Z", captured_at: "2026-09-29T05:00:00Z" };
  assertEquals(planBundlePush([ev("p1", "2026-10-11T14:00:00+09:00", bf), ev("p2", "2026-10-12T14:00:00+09:00", bf)], NOW).skip, "backfill");
});

// T3 우려: worker_unpushed_proposals 는 대표가 이미 처리(무시)돼도 미처리 형제가 남으면 대표 id 를 돌려준다 —
// 대표 status 가 proposed 가 아니라는 이유로 묶음 전체를 건너뛰지 않는다
Deno.test("bundle: lead already dismissed → siblings still pushed (two → EVENT_BUNDLE, one → its single payload)", () => {
  const lead = ev("p1", "2026-10-04T14:00:00+09:00", { status: "dismissed" });
  const two = planBundlePush([lead, ev("p2", "2026-10-11T14:00:00+09:00"), ev("p3", "2026-10-18T14:00:00+09:00")], NOW);
  assertEquals([two.skip, two.skip === null && two.category, two.skip === null && (two.payload.events as unknown[]).length], [null, BUNDLE_CATEGORY, 2]);
  assertEquals(two.skip === null && two.payload.proposal_id, "p2");
  assertEquals(planBundlePush([lead, ev("p2", "2026-10-11T14:00:00+09:00")], NOW), planProposalPush(ev("p2", "2026-10-11T14:00:00+09:00"), NOW));
  assertEquals(planBundlePush([lead, ev("p2", "2026-10-11T14:00:00+09:00", { status: "accepted" })], NOW).skip, "not_proposed");
  assertEquals(planBundlePush([], NOW).skip, "not_proposed");
});

// Review Focus 7: 5건 × 제목 40자(한글)에서도 APNs 4KB 미만
Deno.test("bundle payload stays under 4KB at 5 events × 40-char Korean titles", () => {
  const rows = Array.from({ length: 5 }, (_, i) => ev(crypto.randomUUID(), `2026-10-1${i}T14:00:00+09:00`, { title: "합".repeat(60), version: 12345 }));
  const p = planBundlePush(rows, NOW);
  assert(p.skip === null && p.category === BUNDLE_CATEGORY);
  assert(new TextEncoder().encode(JSON.stringify(p.payload)).length < 4096);
  // 종일 여러 날(end 키가 붙는 가장 긴 원소)이어도
  const spans = Array.from({ length: 5 }, (_, i) => row({ id: crypto.randomUUID(), version: 12345,
    payload: { title: "합".repeat(60), start: `2026-10-1${i}`, end: `2026-10-2${i}`, uncertain: [] } }));
  const q = planBundlePush(spans, NOW);
  assert(q.skip === null && q.category === BUNDLE_CATEGORY);
  assert(new TextEncoder().encode(JSON.stringify(q.payload)).length < 4096);
});

Deno.test("notify worker: bundle of two → one push per device keyed on the job's lead id, payload EVENT_BUNDLE", async () => {
  const { d, calls } = deps({ bundle: [ev("p1", "2026-10-04T14:00:00+09:00"), ev("p2", "2026-10-11T14:00:00+09:00")] });
  const claimed: string[] = [];
  const claim = d.claimPush;
  d.claimPush = async (u, p, dev) => { claimed.push(p); return claim(u, p, dev); };
  assertEquals(await notifyProposal(d, job()), "notified");
  assertEquals([claimed, calls.sent.length], [["p1"], 1]);                     // 기기 1대, 기록 키 = 잡의 대표 id
  assertEquals((calls.sent[0][2] as { aps: { category: string } }).aps.category, "EVENT_BUNDLE");
});

// T3 우려: 대표가 이미 무시됐어도 미처리 형제가 있으면 보낸다. 기록 키는 여전히 잡의 대표 id(재시도·복구가 같은 키를 본다)
Deno.test("notify worker: dismissed lead with pending siblings → still notified, keyed on the lead id", async () => {
  const { d, calls } = deps({ bundle: [ev("p1", "2026-10-04T14:00:00+09:00", { status: "dismissed" }), ev("p2", "2026-10-11T14:00:00+09:00"),
    ev("p3", "2026-10-12T14:00:00+09:00")] });
  const claimed: string[] = [];
  const claim = d.claimPush;
  d.claimPush = async (u, p, dev) => { claimed.push(p); return claim(u, p, dev); };
  assertEquals(await notifyProposal(d, job()), "notified");
  assertEquals(claimed, ["p1"]);
  const sent = calls.sent[0][2] as { aps: { category: string }; events: { proposal_id: string }[] };
  assertEquals([sent.aps.category, sent.events.map((e) => e.proposal_id)], ["EVENT_BUNDLE", ["p2", "p3"]]);
});

// ── 서버 중복(스펙 §7 notify, 0.9.2): 같은 사용자의 다른 항목에 먼저 생긴 대기 제안이 같은 시작 날짜(서울) + 같은 정규화 제목이면 푸시하지 않는다 ──
Deno.test("titleKey: lowercases and drops spaces, symbols and brackets (letters and digits stay)", () => {
  assertEquals(titleKey("[합성] 가을 운동회 (2학년)"), "합성가을운동회2학년");
  assertEquals(titleKey(" 합성  가을운동회! "), titleKey("합성 가을 운동회"));
  assertEquals(titleKey("Synth MEETUP·Day"), "synthmeetupday");
  assertEquals(titleKey("「합성」 공연"), "합성공연");
});

Deno.test("bundle: a pushable whose date and normalized title match an earlier pending peer drops out; none left → duplicate, no push", () => {
  const peers = [{ start: "2026-10-08", title: "합성 가을 운동회" }];
  // 같은 날짜(종일) + 띄어쓰기·기호만 다른 제목 → 중복
  assertEquals(planBundlePush([ev("p1", "2026-10-08", { title: "[합성] 가을운동회" })], NOW, peers).skip, "duplicate");
  // 시각 일정도 서울 시작 날짜로 본다(앞 10자)
  assertEquals(planBundlePush([ev("p1", "2026-10-08T09:00:00+09:00", { title: "합성 가을 운동회" })], NOW, peers).skip, "duplicate");
  // 다른 날짜·다른 제목은 그대로
  assertEquals(planBundlePush([ev("p1", "2026-10-09", { title: "합성 가을 운동회" })], NOW, peers).skip, null);
  assertEquals(planBundlePush([ev("p1", "2026-10-08", { title: "합성 학부모 상담" })], NOW, peers).skip, null);
  // 포함 관계는 서버에서 중복이 아니다(정규화 제목이 같을 때만 — 느슨한 판정은 앱의 "비슷한 일정")
  assertEquals(planBundlePush([ev("p1", "2026-10-08", { title: "합성 가을 운동회 준비물" })], NOW, peers).skip, null);
  // 중복 아닌 이유가 따로 있으면 그 사유가 우선(지난 일정)
  assertEquals(planBundlePush([ev("p1", "2026-09-20", { title: "합성 가을 운동회" })], NOW, [{ start: "2026-09-20", title: "합성 가을 운동회" }]).skip, "past");
});

Deno.test("bundle: duplicates drop out of a bundle — the rest form it (two → EVENT_BUNDLE, one → single ADD_EVENT)", () => {
  const peers = [{ start: "2026-10-04T14:00:00+09:00", title: "합성 p1" }];
  const one = planBundlePush([ev("p1", "2026-10-04T14:00:00+09:00"), ev("p2", "2026-10-11T14:00:00+09:00")], NOW, peers);
  assertEquals(one, planProposalPush(ev("p2", "2026-10-11T14:00:00+09:00"), NOW));
  const two = planBundlePush([ev("p1", "2026-10-04T14:00:00+09:00"), ev("p2", "2026-10-11T14:00:00+09:00"), ev("p3", "2026-10-12")], NOW, peers);
  assert(two.skip === null && two.category === BUNDLE_CATEGORY);
  if (two.skip !== null) return;
  assertEquals([(two.payload.events as { proposal_id: string }[]).map((e) => e.proposal_id), two.payload.proposal_id, aps(two)!.alert.title],
    [["p2", "p3"], "p2", "일정 제안 2건"]);
  // 피어 없음(기본값) = 기존 동작
  assertEquals(planBundlePush([ev("p1", "2026-10-04T14:00:00+09:00")], NOW), planProposalPush(ev("p1", "2026-10-04T14:00:00+09:00"), NOW));
});

Deno.test("notify worker: every pushable is a duplicate → skipped without listing devices; peer read failure → pushes anyway (fail-open)", async () => {
  const dup = deps({ bundle: [ev("p1", "2026-10-08", { title: "합성 운동회" })], peers: [{ start: "2026-10-08", title: "합성  운동회!" }] });
  assertEquals(await notifyProposal(dup.d, job()), "skipped");
  assertEquals([dup.calls.listed, dup.calls.sent.length], [0, 0]);
  const broken = deps({ bundle: [ev("p1", "2026-10-08", { title: "합성 운동회" })], peers: new Error("worker_pending_event_peers PGRST202") });
  assertEquals(await notifyProposal(broken.d, job()), "notified");
  assertEquals(broken.calls.sent.length, 1);
});
