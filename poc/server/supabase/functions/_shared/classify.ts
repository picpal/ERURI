// 서버 분류 게이트(스펙 §7 0b, 2026-09-29 사용자 결정: Jev 채택). 공급자 어댑터(jev.ts, classify-openai.ts)가 이 인터페이스를 구현한다.
// 정책: 비행동 라벨(actionable 외)이고 confidence ≥ 임계(기본 0.8)일 때만 폐기(discarded:server:<label>). 그 외·오류·타임아웃은 추출로
export const LABELS = ["actionable", "personal", "promo", "otp", "notice"] as const;
export type ClassifyLabel = typeof LABELS[number];
export type ClassifyResult = { label: ClassifyLabel; confidence: number };
// 발신자는 넣지 않는다(외부 분류기로 가는 개인정보 최소화, §12 통제 3)
export type ClassifyMeta = { source: string; appName: string | null; title: string | null };
// openai 는 교체 후보(Task 8, 조건부). 어댑터가 생기기 전에는 classifierFromEnv 가 classify openai_not_built 로 실패한다
export type ClassifyProvider = "none" | "jev" | "openai";
export type Classifier = { provider: ClassifyProvider; classify(text: string, meta: ClassifyMeta): Promise<ClassifyResult | null> };

export const DEFAULT_THRESHOLD = 0.8;
export const CLASSIFY_TIMEOUT_MS = 3000;   // 늦으면 게이트를 건너뛴다(스펙 §6 FM 타임아웃과 같은 원칙: 먼저 끝난 쪽이 결과)

// 라벨 경계(2026-09-29 Jev 평가 rubric 그대로. 영어 — Jev 문서상 영어가 주 학습 언어). 어댑터 공용
export const CLASSIFY_INSTRUCTIONS = "Classify this Korean phone notification or text message (app, title, sender, body) for a personal assistant "
  + "that extracts calendar events, tasks, and purchases. Pick the single best category.";
export const LABEL_CRITERIA: Record<ClassifyLabel, { covers: string; not: string }> = {
  actionable: {
    covers: "Anything the recipient may need to act on or record: a schedule, appointment, meeting, reservation or booking, "
      + "a to-do or deadline, an order, purchase, payment, card approval, bill, subscription, delivery status, or pickup. "
      + "Includes messages from friends or family that fix a concrete date/time/place or ask the recipient to do something.",
    not: "Casual chat with no concrete plan; advertising; login codes; informational notices that need no action.",
  },
  personal: {
    covers: "Casual conversation written by a person (friend, family, coworker): greetings, jokes, reactions, small talk.",
    not: "A person's message that sets a concrete appointment or asks for a specific task with a date is actionable.",
  },
  promo: {
    covers: "Advertising or marketing: discounts, coupons, sales, events to sign up for, loan or real-estate offers, "
      + "often marked (광고) or with an opt-out number.",
    not: "Confirmation of something the recipient already ordered, booked, or paid for is actionable.",
  },
  otp: {
    covers: "One-time passwords, verification or login codes (numeric or alphanumeric).",
    not: "Order numbers, approval numbers of card payments, or tracking numbers.",
  },
  notice: {
    covers: "Informational notices from companies or institutions that require no action and carry no date the recipient must meet: "
      + "policy changes, maintenance completed, general alerts.",
    not: "Notices with a deadline, appointment, bill, or delivery are actionable.",
  },
};

export const noneClassifier: Classifier = { provider: "none", classify: () => Promise.resolve(null) };

type Env = (k: string) => string | undefined;
export function classifyThreshold(env: Env): number {
  const n = Number(env("CLASSIFY_THRESHOLD") ?? DEFAULT_THRESHOLD);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : DEFAULT_THRESHOLD;
}

export type Gate = { discard: false } | { discard: true; reason: Exclude<ClassifyLabel, "actionable"> };
export function gateDecision(r: ClassifyResult | null, threshold: number): Gate {
  if (r === null || r.label === "actionable" || r.confidence < threshold) return { discard: false };
  return { discard: true, reason: r.label };
}

export function isClassifyResult(v: unknown): v is ClassifyResult {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.label === "string" && (LABELS as readonly string[]).includes(o.label) &&
    typeof o.confidence === "number" && o.confidence >= 0 && o.confidence <= 1;
}

// 작업이 abort 신호를 무시해도 ms 뒤에는 code 로 실패한다. 시간 초과 뒤 늦게 난 오류는 삼킨다(처리되지 않은 거부 방지)
export async function raceTimeout<T>(run: (signal: AbortSignal) => Promise<T>, ms: number, code: string): Promise<T> {
  const ac = new AbortController();
  let timer: number | undefined;
  const task = run(ac.signal);
  task.catch(() => {});
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { ac.abort(); reject(new Error(code)); }, ms); });
  try {
    return await Promise.race([task, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
