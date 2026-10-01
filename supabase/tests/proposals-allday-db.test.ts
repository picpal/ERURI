import { assert, assertEquals } from "jsr:@std/assert";
import postgres from "npm:postgres@3";
import { encrypt, toBytea } from "../functions/_shared/crypto.ts";
import { RUN, service as sb, userClient } from "./_testenv.ts";

// 호스팅 DB. 전용 테스트 사용자·실행 태그만(AGENTS.md §7). 0026 종일 제안 목록(스펙 §10 대기 목록, 0.9.1).
// 마이그레이션 파일을 한 트랜잭션 안에서 적용하고 authenticated + 테스트 사용자 JWT 클레임으로 부른 뒤 **롤백**한다 —
// db push 전에도(배포 전 검증) 뒤에도(파일이 배포본과 같다) 같은 결과. 시드 행은 service role 로 넣고 finally 에서 지운다.
// 연결: supabase link 의 pooler-url(supabase/.temp) + SUPABASE_DB_PASSWORD(scripts/sql.ts 와 같다)
type Row = { proposal_id: string; action: string; title: string; start: string; end: string | null; all_day: boolean;
  location: string | null; version: number; created_at: string };
const HOUR = 3600_000;
const T0 = Date.now();
const at = (ms: number) => new Date(T0 + ms).toISOString();
const seoulDay = (ms: number) => new Date(T0 + ms + 9 * HOUR).toISOString().slice(0, 10);   // 지금+ms 의 서울 날짜
const DAY = 24 * HOUR;
const MIGRATION = await Deno.readTextFile(new URL("../migrations/0026_proposal_list_all_day.sql", import.meta.url));

async function seed(user: string, tag: string, payload: Record<string, unknown>): Promise<{ item: string; proposal: string }> {
  const { data: item, error } = await sb.rpc("insert_item", { p_user: user, p_source: "NOTIFICATION", p_idempotency_key: `${RUN}:pad:${tag}`,
    p_sender: null, p_title: null, p_content_enc: toBytea(await encrypt(user, "[합성] 합성 공지")), p_occurred_at: new Date().toISOString(), p_enqueue: false });
  if (error) throw new Error("insert_item " + error.code);
  const { data } = await sb.rpc("save_fact", { p_user: user, p_item: item, p_kind: "event", p_payload: payload, p_evidence: "합성", p_action: "create_event" });
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
// 0026 을 적용한 트랜잭션에서 사용자들의 목록과 권한을 읽고 되돌린다
async function listWith0026(users: string[]): Promise<{ lists: Row[][]; anon: boolean; authenticated: boolean }> {
  const sql = connect();
  let out: { lists: Row[][]; anon: boolean; authenticated: boolean } | null = null;
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(MIGRATION);
      const [g] = await tx.unsafe(`select has_function_privilege('anon', 'public.list_pending_proposals()', 'execute') as anon,
        has_function_privilege('authenticated', 'public.list_pending_proposals()', 'execute') as authenticated`);
      const lists: Row[][] = [];
      await tx.unsafe("set local role authenticated");
      for (const u of users) {
        await tx.unsafe("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: u, role: "authenticated" })]);
        const rows = await tx.unsafe("select * from public.list_pending_proposals()");
        lists.push(rows.map((r) => ({ ...r, created_at: String(r.created_at) }) as unknown as Row));
      }
      out = { lists, anon: g.anon, authenticated: g.authenticated };
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  } finally {
    await sql.end();
  }
  return out!;
}

const ISO_SEOUL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/;
// 서버 정렬 규칙(종일 = 그날 서울 0시) 그대로 기대 순서를 만든다(자정 근처 실행에서도 흔들리지 않게)
const sortKey = (r: { start: string; all_day: boolean }) => Date.parse(r.all_day ? `${r.start}T00:00:00+09:00` : r.start);

Deno.test("0026 list_pending_proposals: date-only = all-day rows (start/end YYYY-MM-DD), timed rows as Seoul ISO, filters, order, grants", async () => {
  const { u } = await userClient(1);
  const { u: u2 } = await userClient(2);
  const today = seoulDay(0), yesterday = seoulDay(-DAY);
  const d3 = seoulDay(3 * DAY), d4 = seoulDay(4 * DAY), d5 = seoulDay(5 * DAY), d6 = seoulDay(6 * DAY);
  const s = {
    late: await seed(u.id, "late", { title: "합성 늦은 진료", start: at(48 * HOUR), end: at(49 * HOUR), location: "합성의원 3층", uncertain: [] }),
    grace: await seed(u.id, "grace", { title: "합성 방금 시작", start: at(-30 * 60_000), uncertain: [] }),
    past: await seed(u.id, "past", { title: "합성 지난 일정", start: at(-2 * HOUR), uncertain: [] }),
    day: await seed(u.id, "day", { title: "합성 공지 행사", start: d3, end: null, location: "합성 강당", uncertain: [] }),
    today: await seed(u.id, "today", { title: "합성 오늘 행사", start: today, uncertain: [] }),        // 그날이 아직 안 끝남
    yday: await seed(u.id, "yday", { title: "합성 어제 행사", start: yesterday, uncertain: [] }),
    span: await seed(u.id, "span", { title: "합성 축제", start: d4, end: d6, uncertain: [] }),
    same: await seed(u.id, "same", { title: "합성 하루 행사", start: d5, end: d5, uncertain: [] }),
    tend: await seed(u.id, "tend", { title: "합성 시각 끝", start: d4, end: `${d5}T18:00:00+09:00`, uncertain: [] }),
    back: await seed(u.id, "back", { title: "합성 거꾸로", start: d5, end: d3, uncertain: [] }),
    unc: await seed(u.id, "unc", { title: "합성 날짜 확인", start: d3, uncertain: ["date"] }),
    old: await seed(u.id, "old", { title: "합성 오래된 날짜만", start: d3, uncertain: [] }),
    bad: await seed(u.id, "bad", { title: "합성 없는 날짜", start: d3, uncertain: [] }),
  };
  const all = Object.values(s);
  try {
    await sb.from("proposals").update({ created_at: new Date(Date.now() - 31 * DAY).toISOString() }).eq("id", s.old.proposal);
    // 형식은 맞지만 달력에 없는 날짜(2월 30일). 제품 경로는 저장하지 않으므로 service role 로 직접
    await sb.from("proposals").update({ payload: { title: "합성 없는 날짜", start: "2027-02-30", uncertain: [] } }).eq("id", s.bad.proposal);
    await sb.from("proposals").update({ version: 3 }).eq("id", s.span.proposal);

    const { lists: [rows, other], anon, authenticated } = await listWith0026([u.id, u2.id]);
    const mine = rows.filter((r) => all.some((x) => x.proposal === r.proposal_id));
    const got = new Map(mine.map((r) => [r.proposal_id, r]));
    const want = [s.late, s.grace, s.day, s.today, s.span, s.same, s.tend, s.back];
    assertEquals(new Set(got.keys()), new Set(want.map((x) => x.proposal)));
    for (const x of [s.past, s.yday, s.unc, s.old, s.bad]) assert(!got.has(x.proposal));       // 지남·어제·확인 필요·30일 지남·없는 날짜(목록 전체는 성공)

    // 순서: 종일은 그날 서울 0시로 본 시작 순, 같으면 id
    const expected = [...mine].sort((a, b) => sortKey(a) - sortKey(b) || (a.proposal_id < b.proposal_id ? -1 : 1)).map((r) => r.proposal_id);
    assertEquals(mine.map((r) => r.proposal_id), expected);

    const r = (x: { proposal: string }) => got.get(x.proposal)!;
    // 시각 있는 일정: 서울 ISO(+09:00, 초까지), all_day false, end 는 그대로
    const l = r(s.late);
    assert(ISO_SEOUL.test(l.start) && ISO_SEOUL.test(l.end!));
    assertEquals([l.all_day, l.action, l.title, l.location, Date.parse(l.end!) - Date.parse(l.start)], [false, "ADD_EVENT", "합성 늦은 진료", "합성의원 3층", HOUR]);
    assert(Math.abs(Date.parse(l.start) - (T0 + 48 * HOUR)) < 1000);
    assertEquals([r(s.grace).all_day, r(s.grace).end], [false, null]);
    // 종일: start = 날짜, end = 마지막 날(시작 다음 날 이후일 때만)
    assertEquals([r(s.day).start, r(s.day).end, r(s.day).all_day, r(s.day).location], [d3, null, true, "합성 강당"]);
    assertEquals([r(s.today).start, r(s.today).all_day], [today, true]);
    assertEquals([r(s.span).start, r(s.span).end, r(s.span).version], [d4, d6, 3]);
    assertEquals([r(s.same).end, r(s.tend).end, r(s.back).end], [null, d5, null]);   // 같은 날·시각 있는 end 의 서울 날짜·거꾸로

    assertEquals(other.filter((x) => all.some((y) => y.proposal === x.proposal_id)), []);      // 다른 사용자 격리
    assertEquals([anon, authenticated], [false, true]);
  } finally {
    await cleanup(u.id, all.map((x) => x.item));
  }
});
