// 저장 규칙 채팅 판정과 /chat/rule 버튼(스펙 §9 "저장 규칙 응답"·"카드 버튼", §7 "폐기분 함께 저장", 0.17.0).
// chat 판정은 쓰지 않는다(카드를 누르기 전에는 바뀌지 않는다). 쓰기는 버튼 → 0035 함수. 로그에는 값·제목·본문을 넣지 않는다(§12)
import { matchSaveRules, normalizeRuleValue, type RuleKind, SAVE_RULE_LIMIT, type SaveRule } from "../_shared/save-rules.ts";
import type { ChatDeps } from "./handler.ts";

export type RuleOp = "add" | "list" | "remove";
export type SaveRuleJudgment = { op: RuleOp; status: "ok" | "duplicate" | "limit" | "bad_value" | "not_found";
  candidate: { kind: RuleKind; value: string } | null; matches: SaveRule[]; rules: SaveRule[]; matched: number; limit: 20 };

const key = (v: string) => (normalizeRuleValue(v) ?? v).toLowerCase();

// 모델 칸 판정. matched 는 0 — duplicate 이면 handler 가 그 규칙의 폐기 후보를 센다(Codex 0.17.0 리뷰 #3)
export function judgeSaveRule(op: RuleOp, raw: { kind?: unknown; value?: unknown } | null, rules: SaveRule[]): SaveRuleJudgment {
  const out = (status: SaveRuleJudgment["status"], o: Partial<SaveRuleJudgment> = {}): SaveRuleJudgment =>
    ({ op, status, candidate: null, matches: [], rules: [], matched: 0, limit: SAVE_RULE_LIMIT, ...o });
  if (op === "list") return out("ok", { rules });
  const kind: RuleKind = raw?.kind === "sender" ? "sender" : "keyword";
  const value = normalizeRuleValue(raw?.value);
  if (op === "add") {
    if (value === null) return out("bad_value");
    const same = rules.find((r) => r.kind === kind && key(r.value) === value.toLowerCase());
    if (same) return out("duplicate", { matches: [same] });
    if (rules.length >= SAVE_RULE_LIMIT) return out("limit", { rules });
    return out("ok", { candidate: { kind, value } });
  }
  const eq = (r: SaveRule) => value !== null && key(r.value) === value.toLowerCase();
  const sameKind = rules.filter((r) => r.kind === kind && eq(r));
  const matches = sameKind.length ? sameKind : rules.filter(eq);
  return matches.length ? out("ok", { matches }) : out("not_found", { rules });
}

// 0035 save_rule_candidates 행을 복호화한 것(격리 중 게이트 폐기 + 본문 있음, 최대 500)
export type Candidate = { item_id: string; source: string; app_name: string | null; sender: string | null; title: string | null; text: string };

// 그 규칙 하나에 맞는 후보 id — worker 와 같은 matchSaveRules(마스킹 뒤 저장된 제목·본문, K6)
export function matchingCandidates(rule: Pick<SaveRule, "kind" | "value">, cands: Candidate[]): string[] {
  return cands.filter((c) => matchSaveRules([rule], { title: c.title, text: c.text, sender: c.sender, source: c.source, appName: c.app_name }))
    .map((c) => c.item_id);
}

export type RuleButton = { op: "add"; kind: unknown; value: unknown } | { op: "remove"; rule_id: unknown } | { op: "restore"; rule_id: unknown };
export type RuleDeps = Pick<ChatDeps, "saveRules" | "ruleAdd" | "ruleRemove" | "ruleCandidates" | "ruleRestore">;

// 형식 오류만 400(PF-F13): op 모름·kind/value/rule_id 가 문자열 아님. 두 값 밖 kind 문자열은 SQL 이 bad_value
function parseButton(body: unknown): RuleButton | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (b.op === "add") return typeof b.kind === "string" && typeof b.value === "string" ? { op: "add", kind: b.kind, value: b.value } : null;
  if (b.op === "remove" || b.op === "restore") return typeof b.rule_id === "string" ? { op: b.op, rule_id: b.rule_id } : null;
  return null;
}

// 응답 칸은 모든 status 에서 싣는다(PF-F12 — 앱 디코더의 칸이 non-optional): add {status, rule, rules, matched} · remove {status, rules} · restore {status, restored}
export async function ruleButton(userId: string, body: unknown, deps: RuleDeps): Promise<{ status: number; body: Record<string, unknown> }> {
  const b = parseButton(body);
  if (!b) return { status: 400, body: { error: "bad_request" } };
  const count = async (r: SaveRule) => matchingCandidates(r, await deps.ruleCandidates(userId)).length;
  try {
    if (b.op === "add") {
      const value = b.value as string;
      const a = await deps.ruleAdd(userId, b.kind as RuleKind, normalizeRuleValue(value) ?? value);
      const rules = await deps.saveRules(userId);
      const rule = a.rule_id !== null && (a.status === "added" || a.status === "duplicate") ? rules.find((r) => r.id === a.rule_id) ?? null : null;
      const matched = rule ? await count(rule) : 0;                       // added 는 새 규칙, duplicate 는 기존 규칙(응답 유실 뒤 재시도)
      console.log(JSON.stringify({ save_rule: "add", status: a.status, rules: rules.length, matched }));
      return { status: 200, body: { status: a.status, rule, rules, matched } };
    }
    if (b.op === "remove") {
      const status = await deps.ruleRemove(userId, b.rule_id as string);
      const rules = await deps.saveRules(userId);
      console.log(JSON.stringify({ save_rule: "remove", status, rules: rules.length }));
      return { status: 200, body: { status, rules } };
    }
    const rule = (await deps.saveRules(userId)).find((r) => r.id === b.rule_id);
    const ids = rule ? matchingCandidates(rule, await deps.ruleCandidates(userId)) : [];
    const restored = ids.length ? await deps.ruleRestore(userId, ids) : 0;   // SQL 이 항목마다 조건을 다시 확인 — 그사이 복구·만료분은 빠진다(K21)
    const status = !rule ? "not_found" : restored > 0 ? "queued" : "none";
    console.log(JSON.stringify({ save_rule: "restore", status, restored }));
    return { status: 200, body: { status, restored } };
  } catch (e) {
    console.log(JSON.stringify({ save_rule: b.op, error: e instanceof Error ? e.message : "unknown" }));   // deps 오류 메시지 = 함수 이름 + 코드(deps.ts rpc)
    return { status: 500, body: { error: "internal" } };
  }
}
