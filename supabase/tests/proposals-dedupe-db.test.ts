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
  const { data: item, error } = await sb.rpc("insert_item", { p_user: user, p_source: "NOTIFICATION", p_idempotency_key: `${RUN}:dedupe:${tag}`,
    p_sender: null, p_title: null, p_content_enc: toBytea(await encrypt(user, "[합성] 합성 공지")), p_occurred_at: new Date().toISOString(), p_enqueue: false });
  if (error) throw new Error("insert_item " + error.code);
  const { data, error: e2 } = await sb.rpc("save_fact", { p_user: user, p_item: item, p_kind: "event", p_payload: payload, p_evidence: "합성", p_action: "create_event" });
  if (e2) throw new Error("save_fact " + e2.code);
  return { item: item as string, proposal: (data as { out_proposal_id: string }[])[0].out_proposal_id };
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
      await tx.unsafe(MIGRATION);
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
