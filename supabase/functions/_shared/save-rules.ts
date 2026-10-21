// 저장 규칙(스펙 §7 "저장 규칙", 0.17.0): 키워드 1개 또는 발신자 1개, 사용자당 20개. 맞으면 서버 분류 게이트(Jev)를 건너뛴다.
// 일치 판정은 이 한 함수를 worker(process 잡의 규칙 단계)와 chat(폐기분 비교)이 같이 쓴다. 집계의 발신자 조건은 0035 sender_matches 가 같은 판정(K4)
import { isMessenger } from "./classify.ts";

export type RuleKind = "keyword" | "sender";
export type SaveRule = { id: string; kind: RuleKind; value: string; created_at: string };
export const SAVE_RULE_LIMIT = 20;

// 앞뒤 공백 제거 + 안쪽 연속 공백 한 칸, 길이 2~30 코드 포인트(SQL char_length 와 같은 수, K8). 0035 save_rule_add 도 같은 정규화를 다시 한다(멱등)
export function normalizeRuleValue(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/\s+/g, " ");
  const n = [...s].length;
  return n >= 2 && n <= 30 ? s : null;
}

// 비교 글은 서버 규칙 마스킹 뒤 글(스펙 §16 판정 ⑪, K6). 발신자는 본문·키워드에 쓰지 않는다
export type RuleTarget = { title: string | null; text: string; sender: string | null; source: string; appName: string | null };

const squash = (s: string) => s.toLowerCase().replace(/\s/g, "");

// keyword = 제목 또는 본문에 값이 들어 있음(소문자). sender = 발신자에 값이 들어 있음(값·발신자 양쪽 공백 무시, PF-F5),
// 메신저 항목은 제목(발신자 표시 이름)도 본다. 규칙 하나라도 맞으면 일치
export function matchSaveRules(rules: readonly Pick<SaveRule, "kind" | "value">[], t: RuleTarget): boolean {
  if (rules.length === 0) return false;
  const title = (t.title ?? "").toLowerCase(), text = t.text.toLowerCase();
  const sender = squash(t.sender ?? ""), messenger = isMessenger(t), senderTitle = squash(t.title ?? "");
  return rules.some((r) => {
    if (r.kind === "keyword") {
      const v = r.value.toLowerCase();
      return title.includes(v) || text.includes(v);
    }
    const v = squash(r.value);
    return sender.includes(v) || (messenger && senderTitle.includes(v));
  });
}
