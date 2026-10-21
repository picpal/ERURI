import { assert, assertEquals } from "jsr:@std/assert";
import { decryptCandidates } from "../functions/chat/deps.ts";
import { type Candidate, judgeSaveRule, matchingCandidates, ruleButton, type RuleDeps } from "../functions/chat/save-rule.ts";
import type { SaveRule } from "../functions/_shared/save-rules.ts";

// 저장 규칙 판정·/chat/rule 버튼(스펙 §9 "저장 규칙 응답"·"카드 버튼", §7 "폐기분 함께 저장") — 가짜 deps(메모리 규칙·후보). 값은 합성 문구만
const rule = (id: string, kind: "keyword" | "sender", value: string): SaveRule => ({ id, kind, value, created_at: `2026-10-2${id.length % 10}T00:00:00Z` });
const R1 = rule("r-1", "keyword", "합성PAY"), R2 = rule("r-2", "sender", "합성은행");
const twenty = Array.from({ length: 20 }, (_, i) => rule(`r-${i + 1}`, "keyword", `합성키워드${i + 1}`));
const cand = (item_id: string, o: Partial<Candidate> = {}): Candidate =>
  ({ item_id, source: "NOTIFICATION", app_name: "합성앱", sender: null, title: null, text: "", ...o });

Deno.test("judgeSaveRule add: ok with candidate; duplicate ignores case and inner spaces (matches = existing); 20 → limit with rules; bad_value; unknown kind → keyword", () => {
  const ok = judgeSaveRule("add", { kind: "sender", value: "  합성  택배 " }, [R1]);
  assertEquals(ok, { op: "add", status: "ok", candidate: { kind: "sender", value: "합성 택배" }, matches: [], rules: [], matched: 0, limit: 20 });

  const pin = rule("r-9", "keyword", "pin pay");
  const dup = judgeSaveRule("add", { kind: "keyword", value: "PIN  PAY" }, [R1, pin]);
  assertEquals([dup.status, dup.matches, dup.candidate, dup.matched], ["duplicate", [pin], null, 0]);
  // 종류가 다르면 같은 값이어도 중복이 아니다(0035 unique = (user, kind, value_norm))
  assertEquals(judgeSaveRule("add", { kind: "sender", value: "합성pay" }, [R1]).status, "ok");

  const lim = judgeSaveRule("add", { kind: "keyword", value: "합성새키워드" }, twenty);
  assertEquals([lim.status, lim.rules.length, lim.candidate, lim.matches], ["limit", 20, null, []]);
  // 20개여도 같은 규칙이면 duplicate 가 먼저(SQL save_rule_add 순서와 같다)
  assertEquals(judgeSaveRule("add", { kind: "keyword", value: "합성키워드3" }, twenty).status, "duplicate");

  for (const value of ["가", " 가 ", "", "가".repeat(31), 12, null, undefined]) {
    const b = judgeSaveRule("add", { kind: "keyword", value }, [R1]);
    assertEquals([b.status, b.candidate, b.matches, b.rules], ["bad_value", null, [], []]);
  }
  assertEquals(judgeSaveRule("add", null, []).status, "bad_value");
  assertEquals(judgeSaveRule("add", { value: "가".repeat(30) }, []).status, "ok");      // 30자 = 코드 포인트

  for (const kind of ["phrase", undefined, null, 3]) {
    assertEquals(judgeSaveRule("add", { kind, value: "합성택배" }, []).candidate, { kind: "keyword", value: "합성택배" });
  }
});

Deno.test("judgeSaveRule list: ok with rules in the given order", () => {
  assertEquals(judgeSaveRule("list", null, [R1, R2]), { op: "list", status: "ok", candidate: null, matches: [], rules: [R1, R2], matched: 0, limit: 20 });
  assertEquals(judgeSaveRule("list", null, []).rules, []);
});

Deno.test("judgeSaveRule remove: same kind first, then other kind; none → not_found with rules", () => {
  const k = rule("r-3", "keyword", "합성은행"), s = rule("r-4", "sender", "합성은행");
  assertEquals(judgeSaveRule("remove", { kind: "sender", value: "합성은행" }, [k, s]).matches, [s]);
  assertEquals(judgeSaveRule("remove", { kind: "keyword", value: "합성은행" }, [k, s]).matches, [k]);
  // 모델 칸과 같은 종류가 없으면 다른 종류도 본다
  const other = judgeSaveRule("remove", { kind: "keyword", value: "합성은행" }, [R1, s]);
  assertEquals([other.status, other.matches, other.rules], ["ok", [s], []]);
  // 소문자·안쪽 공백 정규화
  assertEquals(judgeSaveRule("remove", { kind: "keyword", value: " 합성pay " }, [R1, R2]).matches, [R1]);

  const nf = judgeSaveRule("remove", { kind: "keyword", value: "합성없음" }, [R1, R2]);
  assertEquals([nf.status, nf.matches, nf.rules, nf.candidate], ["not_found", [], [R1, R2], null]);
  assertEquals(judgeSaveRule("remove", { kind: "keyword", value: "가" }, [R1]).status, "not_found");
  assertEquals(judgeSaveRule("remove", null, [R1]).rules, [R1]);
});

Deno.test("matchingCandidates: one rule only, keyword/sender/messenger title", () => {
  const cands = [
    cand("i-title", { title: "합성pay 결제 알림" }),
    cand("i-body", { text: "[합성PAY] 결제 타임아웃 발생" }),
    cand("i-other", { text: "합성택배 도착" }),
    cand("i-sender", { source: "MESSAGES", app_name: null, sender: "합성 은행", text: "입금 안내" }),
    cand("i-kakao", { app_name: "카카오톡", title: "합성은행", text: "대화" }),
    cand("i-notif-title", { app_name: "합성앱", title: "합성은행", text: "대화" }),   // 메신저 아님 — 제목은 발신자가 아니다
  ];
  assertEquals(matchingCandidates({ kind: "keyword", value: "합성PAY" }, cands), ["i-title", "i-body"]);
  assertEquals(matchingCandidates({ kind: "sender", value: "합성은행" }, cands), ["i-sender", "i-kakao"]);
  assertEquals(matchingCandidates({ kind: "keyword", value: "합성없음" }, cands), []);
  assertEquals(matchingCandidates({ kind: "keyword", value: "합성PAY" }, []), []);
});

// 가짜 DB: 규칙·후보를 메모리에 두고 0035 함수와 같은 결과를 낸다(정규화·중복·20개·남의 id 없음)
function fake(o: { rules?: SaveRule[]; cands?: Candidate[]; restoreReturns?: number; throwOn?: keyof RuleDeps } = {}) {
  const rules = [...(o.rules ?? [])];
  const seen = { add: [] as [string, string][], remove: [] as string[], restore: [] as string[][], candidates: 0 };
  let n = 100;
  const guard = (k: keyof RuleDeps) => { if (o.throwOn === k) throw new Error(`${k} 42P01`); };
  const deps: RuleDeps = {
    saveRules: async () => { guard("saveRules"); return [...rules]; },
    ruleAdd: async (_u, kind, value) => {
      guard("ruleAdd");
      seen.add.push([kind, value]);
      const v = value.trim().replace(/\s+/g, " ");
      if (!["keyword", "sender"].includes(kind) || [...v].length < 2 || [...v].length > 30) return { status: "bad_value", rule_id: null };
      const same = rules.find((r) => r.kind === kind && r.value.toLowerCase() === v.toLowerCase());
      if (same) return { status: "duplicate", rule_id: same.id };
      if (rules.length >= 20) return { status: "limit", rule_id: null };
      const r = rule(`r-${n++}`, kind as "keyword", v);
      rules.push(r);
      return { status: "added", rule_id: r.id };
    },
    ruleRemove: async (_u, id) => {
      guard("ruleRemove");
      seen.remove.push(id);
      const i = rules.findIndex((r) => r.id === id);
      if (i < 0) return "not_found";
      rules.splice(i, 1);
      return "removed";
    },
    ruleCandidates: async () => { guard("ruleCandidates"); seen.candidates++; return o.cands ?? []; },
    ruleRestore: async (_u, ids) => { guard("ruleRestore"); seen.restore.push(ids); return o.restoreReturns ?? ids.length; },
  };
  return { deps, seen, rules };
}
const U = "user-1";
const ID = "0b8f6c1e-4d2a-4c3b-9e8f-1a2b3c4d5e6f";
const CANDS = [cand("i-1", { text: "[합성PAY] 결제 타임아웃" }), cand("i-2", { title: "합성PAY" }), cand("i-3", { text: "합성택배" })];

async function logged<T>(f: () => Promise<T>): Promise<{ r: T; lines: string[] }> {
  const lines: string[] = [], orig = console.log;
  console.log = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
  try { return { r: await f(), lines }; } finally { console.log = orig; }
}

Deno.test("ruleButton add: added/duplicate both count matched with that rule; limit/bad_value → matched 0", async () => {
  const a = fake({ rules: [R2], cands: CANDS });
  const added = await ruleButton(U, { op: "add", kind: "keyword", value: " 합성PAY " }, a.deps);
  assertEquals(added.status, 200);
  assertEquals(added.body.status, "added");
  assertEquals((added.body.rule as SaveRule).value, "합성PAY");
  assertEquals([(added.body.rules as SaveRule[]).length, added.body.matched], [2, 2]);
  assertEquals(a.seen.add, [["keyword", "합성PAY"]]);                    // chat 이 정규화해 넘긴다(SQL 도 다시, K8)

  const d = fake({ rules: [R1, R2], cands: CANDS });
  const dup = await ruleButton(U, { op: "add", kind: "keyword", value: "합성pay" }, d.deps);
  assertEquals([dup.body.status, dup.body.rule, dup.body.matched], ["duplicate", R1, 2]);
  // 발신자 규칙은 발신자로 센다 — 다른 규칙(R1)에 맞는 후보는 세지 않는다
  const s = fake({ rules: [R1], cands: [...CANDS, cand("i-9", { source: "MESSAGES", app_name: null, sender: "합성은행" })] });
  assertEquals((await ruleButton(U, { op: "add", kind: "sender", value: "합성은행" }, s.deps)).body.matched, 1);

  const l = fake({ rules: twenty, cands: CANDS });
  const lim = await ruleButton(U, { op: "add", kind: "keyword", value: "합성PAY" }, l.deps);
  assertEquals([lim.status, lim.body.status, lim.body.rule, lim.body.matched, (lim.body.rules as SaveRule[]).length, l.seen.candidates],
    [200, "limit", null, 0, 20, 0]);

  // 형식은 맞지만 값이 틀림 → SQL 이 bad_value(PF-F13: 두 값 밖 kind 문자열도 SQL 로), 후보 복호화 없음, 칸은 다 있다(PF-F12)
  for (const body of [{ op: "add", kind: "keyword", value: "가" }, { op: "add", kind: "phrase", value: "합성PAY" }]) {
    const b = fake({ rules: [R1], cands: CANDS });
    const r = await ruleButton(U, body, b.deps);
    assertEquals([r.status, r.body, b.seen.candidates], [200, { status: "bad_value", rule: null, rules: [R1], matched: 0 }, 0]);
  }
});

Deno.test("ruleButton: response lost after commit → same add again → duplicate + matched > 0 → restore with the existing rule id → queued with restored", async () => {
  const f = fake({ cands: CANDS });
  const first = await ruleButton(U, { op: "add", kind: "keyword", value: "합성PAY" }, f.deps);   // 커밋됐지만 앱은 응답을 못 받았다
  assertEquals(first.body.status, "added");
  const again = await ruleButton(U, { op: "add", kind: "keyword", value: "합성PAY" }, f.deps);
  assertEquals([again.body.status, again.body.matched, f.rules.length], ["duplicate", 2, 1]);
  const id = (again.body.rule as SaveRule).id;
  assertEquals(id, (first.body.rule as SaveRule).id);
  const restored = await ruleButton(U, { op: "restore", rule_id: id }, f.deps);
  assertEquals([restored.status, restored.body], [200, { status: "queued", restored: 2 }]);
  assertEquals(f.seen.restore, [["i-1", "i-2"]]);
});

Deno.test("ruleButton restore: passes only ids matching that rule to ruleRestore; 0 matches → none; restore returns 0 → none; unknown rule → not_found", async () => {
  const cands = [...CANDS, cand("i-4", { source: "MESSAGES", app_name: null, sender: "합성은행", text: "합성PAY 아님" })];
  const f = fake({ rules: [R1, R2], cands });
  const r = await ruleButton(U, { op: "restore", rule_id: "r-2" }, f.deps);
  assertEquals([r.body, f.seen.restore], [{ status: "queued", restored: 1 }, [["i-4"]]]);

  const none = fake({ rules: [rule("r-5", "keyword", "합성없음")], cands });
  assertEquals((await ruleButton(U, { op: "restore", rule_id: "r-5" }, none.deps)).body, { status: "none", restored: 0 });
  assertEquals(none.seen.restore, []);                                   // 맞는 것이 없으면 RPC 를 부르지 않는다

  const raced = fake({ rules: [R1], cands, restoreReturns: 0 });       // 그사이 다른 경로로 복구·정리됨(K21)
  assertEquals((await ruleButton(U, { op: "restore", rule_id: "r-1" }, raced.deps)).body, { status: "none", restored: 0 });

  const gone = fake({ rules: [R2], cands });
  assertEquals((await ruleButton(U, { op: "restore", rule_id: "r-1" }, gone.deps)).body, { status: "not_found", restored: 0 });
  assertEquals([gone.seen.candidates, gone.seen.restore], [0, []]);
});

Deno.test("ruleButton remove: removed with rules; second press → not_found", async () => {
  const f = fake({ rules: [R1, R2] });
  const r = await ruleButton(U, { op: "remove", rule_id: "r-1" }, f.deps);
  assertEquals([r.status, r.body], [200, { status: "removed", rules: [R2] }]);
  const again = await ruleButton(U, { op: "remove", rule_id: "r-1" }, f.deps);
  assertEquals(again.body, { status: "not_found", rules: [R2] });
  assertEquals(f.seen.remove, ["r-1", "r-1"]);
});

Deno.test("ruleButton: bad body → 400 bad_request; deps throw → 500 internal", async () => {
  for (const body of [null, "add", [], {}, { op: "list" }, { op: "add", kind: 1, value: "합성PAY" }, { op: "add", kind: "keyword" },
                      { op: "add", kind: "keyword", value: 3 }, { op: "remove" }, { op: "remove", rule_id: 7 }, { op: "restore", rule_id: null }]) {
    const f = fake({ rules: [R1] });
    const r = await ruleButton(U, body, f.deps);
    assertEquals([r.status, r.body], [400, { error: "bad_request" }], JSON.stringify(body));
    assertEquals([f.seen.add.length, f.seen.remove.length, f.seen.restore.length], [0, 0, 0]);
  }
  const cases: [Record<string, unknown>, keyof RuleDeps][] = [[{ op: "add", kind: "keyword", value: "합성PAY" }, "ruleAdd"],
    [{ op: "add", kind: "keyword", value: "합성PAY" }, "ruleCandidates"], [{ op: "remove", rule_id: ID }, "ruleRemove"],
    [{ op: "restore", rule_id: "r-1" }, "saveRules"], [{ op: "restore", rule_id: "r-1" }, "ruleRestore"]];
  for (const [body, throwOn] of cases) {
    const f = fake({ rules: [R1], cands: CANDS, throwOn });
    const { r, lines } = await logged(() => ruleButton(U, body, f.deps));
    assertEquals([r.status, r.body], [500, { error: "internal" }], throwOn);
    assert(lines.every((l) => !l.includes("합성")), lines.join("\n"));
  }
});

Deno.test("ruleButton log: op, status, rule count, matched, restored only — no value, title or body", async () => {
  const f = fake({ rules: [R2], cands: CANDS });
  const { lines } = await logged(async () => {
    await ruleButton(U, { op: "add", kind: "keyword", value: "합성PAY" }, f.deps);
    await ruleButton(U, { op: "restore", rule_id: "r-100" }, f.deps);
    await ruleButton(U, { op: "remove", rule_id: "r-100" }, f.deps);
  });
  assertEquals(lines.map((l) => JSON.parse(l)), [
    { save_rule: "add", status: "added", rules: 2, matched: 2 },
    { save_rule: "restore", status: "queued", restored: 2 },
    { save_rule: "remove", status: "removed", rules: 1 },
  ]);
  assert(lines.every((l) => !l.includes("합성") && !l.includes("i-")), lines.join("\n"));
});

// Ruling A8-decrypt: 복호화가 실패한 행은 후보에서 빼고(불일치로 셈) 실패 수만 돌려준다 — 감사는 cands 의 id 만 해시
Deno.test("decryptCandidates: one row fails → the rest returned in order, failed 1, failed id out of the audited list", async () => {
  const row = (item_id: string, content_enc: string) => ({ item_id, source: "NOTIFICATION", app_name: "합성앱", sender: null, title: null, content_enc });
  const { cands, failed } = await decryptCandidates([row("i-1", "enc-1"), row("i-2", "bad"), row("i-3", "enc-3")], (enc) => {
    if (enc === "bad") return Promise.reject(new Error("decrypt"));
    return Promise.resolve(`합성본문 ${enc}`);
  });
  assertEquals(failed, 1);
  assertEquals(cands.map((c) => [c.item_id, c.text]), [["i-1", "합성본문 enc-1"], ["i-3", "합성본문 enc-3"]]);
  assert(!cands.some((c) => c.item_id === "i-2"));
});
