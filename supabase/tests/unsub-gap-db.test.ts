import { assert, assertEquals } from "jsr:@std/assert";
import postgres from "npm:postgres@3";
import { RUN, testUser } from "./_testenv.ts";

// 호스팅 DB. 전용 테스트 사용자·실행 태그만(AGENTS.md §7). 0029 일일 광고 공백 스캔(스펙 §7 도착 경로, 리뷰 U4-I2).
// proposals-dedupe-db 와 같은 방식: 0029 를 한 트랜잭션 안에서만 적용하고 부른 뒤 **롤백** — db push(U6b) 전에도 뒤에도 같은 결과.
// 연결·잡 행도 같은 트랜잭션에서 만들어 롤백으로 사라진다(운영 워커는 커밋 전 행을 보지 못한다)
const MIGRATION = await Deno.readTextFile(new URL("../migrations/0029_unsub_gap_scan.sql", import.meta.url));
const DAY_S = 86_400;

function connect() {
  const base = Deno.readTextFileSync(new URL("../.temp/pooler-url", import.meta.url)).trim();
  const url = new URL(base);
  return postgres({ host: url.hostname, port: Number(url.port || 5432), database: url.pathname.slice(1) || "postgres",
    username: decodeURIComponent(url.username), password: Deno.env.get("SUPABASE_DB_PASSWORD")!, ssl: "require", prepare: false, onnotice: () => {} });
}

class Rollback extends Error {}
type Tx = postgres.TransactionSql;
async function with0029(body: (tx: Tx) => Promise<void>) {
  const sql = connect();
  try {
    await sql.begin(async (tx) => {
      const [{ deployed }] = await tx.unsafe("select to_regprocedure('public.gmail_enqueue_unsub_gap(uuid, text)') is not null as deployed");
      if (!deployed) await tx.unsafe(MIGRATION);
      await body(tx);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  } finally {
    await sql.end();
  }
}
const conn = async (tx: Tx, user: string, status = "active") =>
  (await tx.unsafe("insert into connections (user_id, provider, account_ref, status) values ($1, 'gmail', $2, $3) returning id",
    [user, `${RUN}-${crypto.randomUUID().slice(0, 8)}@example.com`, status]))[0].id as string;
const scans = (tx: Tx, user: string, prefix: string) =>
  tx.unsafe(`select lease_key, priority, payload, jsonb_typeof(payload->'after') as after_type from jobs
             where user_id = $1 and kind = 'gmail-unsub-scan' and lease_key like $2 || '%'`, [user, prefix]);

Deno.test("0029 gmail_enqueue_unsub_gap: one 8-day gap scan per active gmail connection of the scoped user, on the backfill lane; pending dedup; inactive and other users untouched", async () => {
  const u = (await testUser(1)).id, u2 = (await testUser(2)).id;
  await with0029(async (tx) => {
    const a = await conn(tx, u), off = await conn(tx, u, "reauth_required"), other = await conn(tx, u2);
    const prefix = RUN + ":";
    const now = Math.floor(Date.now() / 1000);
    const [{ n }] = await tx.unsafe("select gmail_enqueue_unsub_gap($1, $2) as n", [u, prefix]);
    assert(n >= 1, String(n));                                                 // 사용자 1은 다른 실행의 active 연결을 가질 수 있다 — 결과는 연결 id 로 본다
    const mine = (await scans(tx, u, prefix)).filter((j) => [a, off].includes(j.payload.connection_id));
    assertEquals(mine.length, 1);
    const [j] = mine;
    assertEquals([j.payload.connection_id, j.lease_key, j.priority, j.payload.backfill, j.payload.lease_key, j.after_type],
      [a, `${prefix}backfill:${u}`, 40, true, `${prefix}backfill:${u}`, "number"]);   // 워커는 typeof after === "number" 일 때만 좁힌다
    assert(Math.abs(j.payload.after - (now - 8 * DAY_S)) < 120, String(j.payload.after));   // 주간 재인증 공백(7일)보다 하루 넓게
    assertEquals((await scans(tx, u2, prefix)).filter((x) => x.payload.connection_id === other), []);   // p_user 범위 밖
    assertEquals((await tx.unsafe("select gmail_enqueue_unsub_gap($1, $2) as n", [u, prefix]))[0].n, 0);   // 이미 대기 중

    // 0028 호출 형식 그대로(after 없음) — 30일 스캔은 payload 에 after 가 없다
    const p2 = RUN + ":b:";
    assert((await tx.unsafe("select gmail_enqueue_unsub_scan(p_user => $1, p_lease_prefix => $2) as n", [u, p2]))[0].n >= 1);
    const full = (await scans(tx, u, p2)).find((x) => x.payload.connection_id === a)!;
    assertEquals([full.after_type, full.payload.lease_key], [null, `${p2}backfill:${u}`]);

    // 운영 접두가 아닌 접두는 거부(0028 과 같다)
    await assertRaises(tx, "select gmail_enqueue_unsub_gap($1, 'evil:')", [u]);
    await assertRaises(tx, "select gmail_enqueue_unsub_scan($1, 'evil:', now())", [u]);
  });
});

Deno.test("0029: daily cron at KST dawn calls the gap scan for all users; functions are not executable by anon/authenticated", async () => {
  await with0029(async (tx) => {
    const rows = await tx.unsafe("select schedule, command from cron.job where jobname = 'unsub-gap-scan-daily'");
    assertEquals(rows.length, 1);
    assertEquals(rows[0].schedule, "27 19 * * *");                             // UTC 19:27 = KST 04:27, 다른 cron 분(0·7·17·23·33·41·43)과 겹치지 않음
    assert(/select\s+gmail_enqueue_unsub_gap\(\)/.test(rows[0].command), rows[0].command);
    for (const sig of ["public.gmail_enqueue_unsub_gap(uuid, text)", "public.gmail_enqueue_unsub_scan(uuid, text, timestamptz)"]) {
      const [g] = await tx.unsafe(`select has_function_privilege('anon', '${sig}', 'execute') as anon,
        has_function_privilege('authenticated', '${sig}', 'execute') as authenticated`);
      assertEquals([sig, g.anon, g.authenticated], [sig, false, false]);
    }
    const [{ old }] = await tx.unsafe("select to_regprocedure('public.gmail_enqueue_unsub_scan(uuid, text)') is not null as old");
    assertEquals(old, false);                                                  // 겹치는 오버로드 없음(이름 호출이 모호해지지 않게)
  });
});

async function assertRaises(tx: Tx, q: string, args: unknown[]) {
  let raised = false;
  try { await tx.savepoint((sp) => sp.unsafe(q, args as never[])); } catch { raised = true; }
  assert(raised, q);
}
