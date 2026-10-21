import { assertEquals } from "jsr:@std/assert";
import { matchSaveRules, normalizeRuleValue, SAVE_RULE_LIMIT, type RuleTarget } from "../functions/_shared/save-rules.ts";
import { MESSENGER_APPS } from "../functions/_shared/classify.ts";
import { MIGRATION_0035, SENDER_TABLE } from "./_agg-sql.ts";

// 저장 규칙 일치 판정(스펙 §7 "저장 규칙"). 값은 합성 글만
const target = (o: Partial<RuleTarget> = {}): RuleTarget =>
  ({ title: null, text: "합성 본문", sender: null, source: "MESSAGES", appName: null, ...o });

Deno.test("normalizeRuleValue: trims, collapses inner spaces, 2..30 code points", () => {
  assertEquals(normalizeRuleValue("  PIN   PAY \n"), "PIN PAY");
  assertEquals([normalizeRuleValue("가"), normalizeRuleValue("가".repeat(31)), normalizeRuleValue(3)], [null, null, null]);
  assertEquals(normalizeRuleValue("가".repeat(30)), "가".repeat(30));
  // 코드 포인트로 센다(K8) — 서로게이트 쌍 이모지 15개 = 30 코드 포인트(UTF-16 길이 60)
  assertEquals(normalizeRuleValue("😀".repeat(15)), "😀".repeat(15));
  assertEquals([normalizeRuleValue("   "), normalizeRuleValue(null), normalizeRuleValue(" 가 ")], [null, null, null]);
  assertEquals(SAVE_RULE_LIMIT, 20);
});

Deno.test("matchSaveRules keyword: case-insensitive; title only or body only; no rules → false", () => {
  const kw = [{ kind: "keyword" as const, value: "합성PAY" }];
  assertEquals(matchSaveRules(kw, target({ text: "[합성pay] 결제 타임아웃" })), true);           // 본문만, 대소문자 무시
  assertEquals(matchSaveRules(kw, target({ title: "합성PAY 알림", text: "결제 지연" })), true);   // 제목만
  assertEquals(matchSaveRules(kw, target({ title: null, text: "합성카드 결제" })), false);
  assertEquals(matchSaveRules(kw, target({ text: "합성 PAY" })), false);                          // 키워드는 공백을 지우지 않는다
  assertEquals(matchSaveRules(kw, target({ sender: "합성PAY", text: "결제" })), false);           // 키워드는 발신자를 보지 않는다
  assertEquals(matchSaveRules([], target({ title: "합성PAY", text: "합성PAY" })), false);
  // 규칙 하나라도 맞으면 일치
  assertEquals(matchSaveRules([{ kind: "keyword", value: "합성택배" }, ...kw], target({ text: "합성PAY 승인" })), true);
});

Deno.test("matchSaveRules sender: SENDER_TABLE (same rows as the SQL cases)", () => {
  for (const [source, app, sender, title, value, want] of SENDER_TABLE) {
    assertEquals(matchSaveRules([{ kind: "sender", value }], { title, text: "합성 본문", sender, source, appName: app }), want,
      JSON.stringify([source, app, sender, title, value]));
  }
});

Deno.test("matchSaveRules sender: value and sender both ignore spaces (PF-F5); non-messenger titles are not senders", () => {
  const s = [{ kind: "sender" as const, value: "합성 은행" }];
  assertEquals(matchSaveRules(s, target({ sender: "합성은행" })), true);
  assertEquals(matchSaveRules(s, target({ sender: "합성\t은 행" })), true);
  assertEquals(matchSaveRules(s, target({ source: "NOTIFICATION", appName: "합성앱", title: "합성은행" })), false);
  assertEquals(matchSaveRules(s, target({ sender: null, text: "합성은행 안내" })), false);         // 발신자는 본문을 보지 않는다
});

Deno.test("messenger list in 0035 equals classify.ts MESSENGER_APPS", async () => {
  const sql = await Deno.readTextFile(MIGRATION_0035);
  const block = sql.slice(sql.indexOf("-- MESSENGER_APPS"));
  const arr = block.slice(block.indexOf("array[") + 6, block.indexOf("]"));
  assertEquals(new Set(arr.split(",").map((s) => s.trim().replace(/^'|'$/g, ""))), new Set(MESSENGER_APPS));
});
