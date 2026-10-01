import { assertEquals } from "jsr:@std/assert";
import postgres from "npm:postgres@3";
import { encrypt, toBytea } from "../functions/_shared/crypto.ts";
import { type PeerProposal, planBundlePush, type ProposalRow } from "../functions/_shared/notify.ts";
import { RUN, service as sb, testUser } from "./_testenv.ts";

// 호스팅 DB. 전용 테스트 사용자·실행 태그만(AGENTS.md §7). 0027 서버 중복(스펙 §7 notify, 0.9.2).
// proposals-allday-db 와 같은 방식: 마이그레이션을 한 트랜잭션 안에서 적용하고 부른 뒤 **롤백** — db push 전에도 뒤에도 같은 결과.
// 시드 행은 service role 로 넣고 finally 에서 지운다
const DAY = 86_400_000;
const seoulDay = (ms: number) => new Date(Date.now() + ms + 9 * 3600_000).toISOString().slice(0, 10);
const MIGRATION = await Deno.readTextFile(new URL("../migrations/0027_proposal_push_dedupe.sql", import.meta.url));

async function seed(user: string, tag: string, payload: Record<string, unknown>): Promise<{ item: string; proposal: string }> {
  const item = await newItem(user, tag);
  const proposals = await saveEvents(user, item, [payload]);
  return { item, proposal: proposals[0] };
}

async function newItem(user: string, tag: string): Promise<string> {
  const { data: item, error } = await sb.rpc("insert_item", { p_user: user, p_source: "NOTIFICATION", p_idempotency_key: `${RUN}:dedupe:${tag}`,
    p_sender: null, p_title: null, p_content_enc: toBytea(await encrypt(user, "[합성] 합성 공지")), p_occurred_at: new Date().toISOString(), p_enqueue: false });
  if (error) throw new Error("insert_item " + error.code);
  return item as string;
}

// 한 항목의 일정들(0025 save_facts — 둘 이상이면 묶음, 순번 0 이 대표)
async function saveEvents(user: string, item: string, payloads: Record<string, unknown>[]): Promise<string[]> {
  const { data, error } = await sb.rpc("save_facts", { p_user: user, p_item: item, p_kind: "event", p_action: "create_event",
    p_entries: payloads.map((payload) => ({ payload, evidence: "합성" })) });
  if (error) throw new Error("save_facts " + error.code);
  return (data as { out_proposal_id: string }[]).map((r) => r.out_proposal_id);
}

// 발송 기록(worker 가 남기는 것과 같은 행). 기기 id 는 실행 태그
async function pushed(user: string, proposal: string, status: "sent" | "failed" | "rejected" = "sent") {
  const { error } = await sb.from("proposal_pushes").insert({ user_id: user, proposal_id: proposal, device_id: `${RUN}:dev`, status });
  if (error) throw new Error("proposal_pushes " + error.code);
}

async function cleanup(user: string, items: string[]) {
  await sb.from("facts").delete().eq("user_id", user).in("item_id", items);                         // proposals cascade
  await sb.from("items").delete().eq("user_id", user).in("id", items);
}

function connect() {
  const base = Deno.readTextFileSync(new URL("../.temp/pooler-url", import.meta.url)).trim();
  const url = new URL(base);
  return postgres({ host: url.hostname, port: Number(url.port || 5432), database: url.pathname.slice(1) || "postgres",
    username: decodeURIComponent(url.username), password: Deno.env.get("SUPABASE_DB_PASSWORD")!, ssl: "require", prepare: false, onnotice: () => {} });
}

class Rollback extends Error {}
type Peer = PeerProposal & { id: string };
// 0027 을 적용한 트랜잭션에서 (사용자, 제안)마다 피어를 읽고 권한을 본 뒤 되돌린다
async function peersWith0027(calls: [string, string][]): Promise<{ peers: Peer[][]; anon: boolean; authenticated: boolean }> {
  const sql = connect();
  let out: { peers: Peer[][]; anon: boolean; authenticated: boolean } | null = null;
  try {
    await sql.begin(async (tx) => {
      // 배포 전에는 0027 을 이 트랜잭션에만 적용, 배포 뒤에는 배포본을 그대로 쓴다(create function 재실행 불가)
      const [{ deployed }] = await tx.unsafe("select to_regprocedure('public.worker_pending_event_peers(uuid, uuid)') is not null as deployed");
      if (!deployed) await tx.unsafe(MIGRATION);
      const sig = "public.worker_pending_event_peers(uuid, uuid)";
      const [g] = await tx.unsafe(`select has_function_privilege('anon', '${sig}', 'execute') as anon,
        has_function_privilege('authenticated', '${sig}', 'execute') as authenticated`);
      const peers: Peer[][] = [];
      for (const [u, p] of calls) peers.push([...await tx.unsafe("select * from public.worker_pending_event_peers($1, $2)", [u, p])] as unknown as Peer[]);
      out = { peers, anon: g.anon, authenticated: g.authenticated };
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  } finally {
    await sql.end();
  }
  return out!;
}

Deno.test("0027 worker_pending_event_peers: earlier pending create_event proposals of other items on the same Seoul start date; plan drops the duplicate", async () => {
  const u = (await testUser(1)).id, u2 = (await testUser(2)).id;
  const d3 = seoulDay(3 * DAY), d4 = seoulDay(4 * DAY);
  const s = {
    first: await seed(u, "first", { title: "합성 가을 운동회", start: d3, uncertain: [] }),                         // 먼저 온 공지(종일)
    timed: await seed(u, "timed", { title: "합성 학부모 상담", start: `${d3}T15:00:00+09:00`, uncertain: [] }),       // 같은 날 다른 일정(시각)
    other: await seed(u, "other", { title: "합성 가을 운동회", start: d4, uncertain: [] }),                         // 다른 날
    gone: await seed(u, "gone", { title: "합성 가을 운동회", start: d3, uncertain: [] }),                           // 무시함
    theirs: await seed(u2, "theirs", { title: "합성 가을 운동회", start: d3, uncertain: [] }),                      // 다른 사용자
    again: await seed(u, "again", { title: "[합성] 가을운동회", start: d3, uncertain: [] }),                        // 나중에 온 같은 일정
  };
  const mine = [s.first, s.timed, s.other, s.gone, s.again];
  try {
    // 생성 순서를 확정한다(같은 초에 만들어져도 흔들리지 않게): again 이 가장 나중
    const order = [s.first, s.timed, s.other, s.gone, s.again];
    for (const [i, x] of order.entries()) {
      await sb.from("proposals").update({ created_at: new Date(Date.now() - (10 - i) * 60_000).toISOString() }).eq("id", x.proposal);
    }
    await sb.from("proposals").update({ status: "dismissed" }).eq("id", s.gone.proposal);
    // 먼저 온 것들은 이미 푸시됐다(피어 조건 — 발송 기록 없는 피어는 아래 테스트)
    for (const x of [s.first, s.timed, s.other, s.gone, s.theirs]) await pushed(x === s.theirs ? u2 : u, x.proposal);

    const { peers: [forAgain, forFirst, forTheirs, wrongUser], anon, authenticated } = await peersWith0027([
      [u, s.again.proposal], [u, s.first.proposal], [u2, s.theirs.proposal], [u2, s.again.proposal]]);
    // 나중 것: 같은 날 먼저 생긴 대기 제안(제목 무관 — 비교는 워커) — 무시한 것·다른 날·다른 사용자·자기 항목은 없다
    assertEquals(new Set(forAgain.map((p) => p.id)), new Set([s.first.proposal, s.timed.proposal]));
    assertEquals(forAgain.find((p) => p.id === s.first.proposal)!.start, d3);
    // 먼저 온 것: 뒤에 온 제안은 피어가 아니다(동시에 돌아도 둘 다 빠지지 않는다)
    assertEquals(forFirst, []);
    assertEquals(forTheirs, []);                                                                      // 다른 사용자 격리
    assertEquals(wrongUser, []);                                                                      // 남의 제안 id
    assertEquals([anon, authenticated], [false, false]);

    // 워커 판정(정규화 제목): 나중 공지는 중복으로 푸시 없음, 먼저 온 공지는 그대로
    const row = (x: { proposal: string }, title: string): ProposalRow => ({ id: x.proposal, action: "create_event", status: "proposed", version: 1,
      occurred_at: null, captured_at: null, payload: { title, start: d3, uncertain: [] } });
    assertEquals(planBundlePush([row(s.again, "[합성] 가을운동회")], new Date(), forAgain).skip, "duplicate");
    assertEquals(planBundlePush([row(s.first, "합성 가을 운동회")], new Date(), forFirst).skip, null);
  } finally {
    await cleanup(u, mine.map((x) => x.item));
    await cleanup(u2, [s.theirs.item]);
  }
});

Deno.test("0027 worker_pending_event_peers: only peers whose item was actually pushed (sent, item-level) — a backfill/unsent earlier proposal does not swallow the later push", async () => {
  const u = (await testUser(1)).id;
  const d3 = seoulDay(3 * DAY);
  const ev = (title: string) => ({ title, start: d3, uncertain: [] });
  const s = {
    backfill: await seed(u, "nb-backfill", ev("합성 가을 운동회")),                 // 백필로 건너뜀 — 발송 기록 없음
    failed: await seed(u, "nb-failed", ev("합성 가을 운동회")),                     // 발송 실패만
    again: await seed(u, "nb-again", ev("[합성] 가을운동회")),                      // 나중에 온 같은 일정
  };
  // 묶음 항목: 대표(순번 0)에만 발송 기록이 남는다. 같은 일정은 형제 쪽 — 자기 id 로는 기록 없음
  const bundleItem = await newItem(u, "nb-bundle");
  const [lead, sibling] = await saveEvents(u, bundleItem, [ev("합성 학부모 상담"), ev("합성 가을 운동회")]);
  const items = [s.backfill.item, s.failed.item, bundleItem, s.again.item];
  try {
    const order = [s.backfill.proposal, s.failed.proposal, lead, sibling, s.again.proposal];
    for (const [i, id] of order.entries()) {
      await sb.from("proposals").update({ created_at: new Date(Date.now() - (10 - i) * 60_000).toISOString() }).eq("id", id);
    }
    await pushed(u, s.failed.proposal, "failed");

    // 1) 아무것도 발송되지 않았다: 피어 없음 → 나중 제안은 푸시된다
    const row: ProposalRow = { id: s.again.proposal, action: "create_event", status: "proposed", version: 1,
      occurred_at: null, captured_at: null, payload: ev("[합성] 가을운동회") };
    const { peers: [none] } = await peersWith0027([[u, s.again.proposal]]);
    assertEquals(none, []);
    assertEquals(planBundlePush([row], new Date(), none).skip, null);

    // 2) 묶음 대표에 발송 기록 → 같은 항목의 형제도 피어(항목 단위). 백필·실패 피어는 여전히 아니다
    await pushed(u, lead);
    const { peers: [withBundle] } = await peersWith0027([[u, s.again.proposal]]);
    assertEquals(new Set(withBundle.map((p) => p.id)), new Set([lead, sibling]));
    assertEquals(planBundlePush([row], new Date(), withBundle).skip, "duplicate");
  } finally {
    await cleanup(u, items);
  }
});
