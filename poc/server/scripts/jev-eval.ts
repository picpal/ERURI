// Jev 분류 게이트 평가(2026-09-29 리포트, 0b Task 7 에서 운영 요청 형태로 정리). 합성 문구 60개(eval/phrases.json)를 운영 어댑터와 같은 요청
// (_shared/jev.ts buildJevRequest: jev-1.13.0 고정, 발신자 미전송, 메신저 제목 미전송(classifierMeta), 경계 LABEL_CRITERIA)으로 분류해 라벨별 정밀도·재현율, 혼동 행렬, 지연, 비용,
// 신뢰도 임계값별 폐기/추출 비율을 잰다. 서버 규칙(rules.ts)과 결합한 결과도 같이 낸다.
// 사용: cd poc/server && deno run -A --env-file=.env scripts/jev-eval.ts [prod|bare]
//   prod(기본): 운영 요청 그대로. bare: 라벨당 한 줄 설명만(기준 설명 의존도 확인용 대조군)
// 출력: eval/jev-results-prod.json (bare 는 eval/jev-results-bare-prod.json). 리포트 원자료(jev-results.json·jev-results-bare.json)는 덮어쓰지 않는다.
// 합성 값만. 키는 JEV_API_KEY 로만 읽고 출력하지 않는다.
import { CLASSIFY_INSTRUCTIONS, classifierMeta, type ClassifyLabel, LABEL_CRITERIA, LABELS } from "../supabase/functions/_shared/classify.ts";
import { buildJevRequest, JEV_ENDPOINT, JEV_MODEL } from "../supabase/functions/_shared/jev.ts";
import { applyRules } from "../supabase/functions/_shared/rules.ts";

type Label = ClassifyLabel;
type Phrase = {
  id: string; label: Label; app: "SMS" | "Slack" | "KakaoTalk"; title: string | null; sender: string | null; text: string;
  device10?: { topic: string; device: string };
};
type ChoiceAnswer = { type: "choice"; choice: Label; confidence: number; probabilities: Record<Label, number> };
type SystemOneResponse = { model: string; answers: { kind: ChoiceAnswer }; usage: { input_tokens: number; output_tokens: number } };

const ENDPOINT = JEV_ENDPOINT, MODEL = JEV_MODEL, INSTRUCTIONS = CLASSIFY_INSTRUCTIONS, CRITERIA = LABEL_CRITERIA;
const USD_PER_INPUT_TOKEN = 0.042 / 1e6;   // docs.typesafe.ai/models: $42/Btok 입력, 출력 무료 (jev-1.13.0)
const THRESHOLDS = [0, 0.6, 0.8, 0.9];
const KEY = Deno.env.get("JEV_API_KEY");
if (!KEY) throw new Error("JEV_API_KEY 없음 (--env-file=.env)");
const BARE: Record<Label, string> = {
  actionable: "Schedule, task, purchase, payment, bill, reservation, or delivery",
  personal: "Casual personal chat",
  promo: "Advertising",
  otp: "Verification code",
  notice: "Informational notice, no action needed",
};
const VARIANT = Deno.args[0] === "bare" ? "bare" : "prod";

type State = { app: string; title: string | null; sender: string | null; body: string };   // sender 는 기록용. 요청에는 넣지 않는다

async function classify(state: State): Promise<{ res: SystemOneResponse; ms: number; retries: number }> {
  const body = JSON.stringify(buildJevRequest(state.body, classifierMeta({ source: "NOTIFICATION", appName: state.app, title: state.title }),
    VARIANT === "bare" ? BARE : CRITERIA));
  for (let attempt = 0; ; attempt++) {
    const t0 = performance.now();
    const r = await fetch(ENDPOINT, { method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }, body });
    const ms = performance.now() - t0;
    if ((r.status === 429 || r.status === 529) && attempt < 4) {
      await r.body?.cancel();
      const ra = Number(r.headers.get("retry-after"));
      await new Promise((ok) => setTimeout(ok, (ra > 0 ? ra * 1000 : 500 * 2 ** attempt)));
      continue;
    }
    if (!r.ok) throw new Error(`jev ${r.status} ${(await r.text()).slice(0, 300)}`);
    return { res: await r.json(), ms, retries: attempt };
  }
}

const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]; };
const r3 = (x: number) => Math.round(x * 1000) / 1000;

const phrases: Phrase[] = JSON.parse(await Deno.readTextFile(new URL("../eval/phrases.json", import.meta.url))).phrases;

// 워밍업 1회(TLS·연결 수립). 통계에서 제외
await classify({ app: "SMS", title: null, sender: null, body: "테스트 문장입니다." });

type Row = Phrase & {
  rule: string; sent: "masked" | "raw"; pred: Label; confidence: number; probabilities: Record<Label, number>;
  ms: number; retries: number; input_tokens: number; model: string;
};
const rows: Row[] = [];
for (const p of phrases) {
  const v = applyRules(p.text, { title: p.title, sender: p.sender });
  const body = v.kind === "pass" ? v.masked : p.text;          // 파이프라인이 보낼 본문(마스킹). 규칙 폐기 건도 Jev 단독 정확도를 위해 원문(합성) 전송
  const title = v.kind === "pass" ? v.maskedTitle ?? p.title : p.title;
  const { res, ms, retries } = await classify({ app: p.app, title, sender: p.sender, body });
  const a = res.answers.kind;
  rows.push({ ...p, rule: v.kind === "pass" ? "pass" : `discard:${v.reason}`, sent: v.kind === "pass" ? "masked" : "raw",
    pred: a.choice, confidence: a.confidence, probabilities: a.probabilities, ms, retries, input_tokens: res.usage.input_tokens, model: res.model });
  console.log(`${p.id} ${p.label.padEnd(10)} → ${a.choice.padEnd(10)} conf=${a.confidence.toFixed(2)} ${ms.toFixed(0)}ms rule=${rows.at(-1)!.rule}`);
}

// 라벨별 정밀도·재현율, 혼동 행렬(행=정답, 열=예측)
const confusion = Object.fromEntries(LABELS.map((t) => [t, Object.fromEntries(LABELS.map((p) => [p, rows.filter((r) => r.label === t && r.pred === p).length]))]));
const perLabel = Object.fromEntries(LABELS.map((l) => {
  const tp = rows.filter((r) => r.label === l && r.pred === l).length;
  const predN = rows.filter((r) => r.pred === l).length, trueN = rows.filter((r) => r.label === l).length;
  return [l, { n: trueN, predicted: predN, tp, precision: predN ? r3(tp / predN) : null, recall: r3(tp / trueN) }];
}));
const accuracy5 = r3(rows.filter((r) => r.label === r.pred).length / rows.length);
// 게이트(이진): actionable → 추출로 통과, 그 외 → 폐기
const gateOk = (r: Row) => (r.label === "actionable") === (r.pred === "actionable");
const gateAccuracy = r3(rows.filter(gateOk).length / rows.length);

// 임계값 정책: pred ≠ actionable 이고 confidence ≥ t 일 때만 폐기, 나머지는 추출로 넘긴다
function policy(t: number, subset: Row[] = rows, preDiscarded = new Set<string>()) {
  const discarded = subset.filter((r) => preDiscarded.has(r.id) || (r.pred !== "actionable" && r.confidence >= t));
  const passed = subset.filter((r) => !discarded.includes(r));
  const wrongDiscard = discarded.filter((r) => r.label === "actionable");
  const leaked = passed.filter((r) => r.label !== "actionable");
  return {
    threshold: t, discarded: discarded.length, passed: passed.length,
    discard_precision: discarded.length ? r3(1 - wrongDiscard.length / discarded.length) : null,
    pass_rate: r3(passed.length / subset.length),
    actionable_lost: wrongDiscard.map((r) => r.id),
    non_actionable_passed: leaked.length,
    non_actionable_filtered_rate: r3(1 - leaked.length / subset.filter((r) => r.label !== "actionable").length),
    gate_accuracy: r3((subset.length - wrongDiscard.length - leaked.length) / subset.length),
  };
}
const thresholdTable = THRESHOLDS.map((t) => policy(t));
// 서버 규칙(OTP·(광고)) 먼저, 남은 것만 Jev
const ruleDiscarded = new Set(rows.filter((r) => r.rule !== "pass").map((r) => r.id));
const pipelineTable = THRESHOLDS.map((t) => policy(t, rows, ruleDiscarded));

const lat = rows.map((r) => r.ms);
const tokens = rows.reduce((s, r) => s + r.input_tokens, 0);
const result = {
  run_at: new Date().toISOString(), endpoint: ENDPOINT, model_alias: MODEL, variant: VARIANT, model: [...new Set(rows.map((r) => r.model))],
  n: rows.length, labels: LABELS, instructions: INSTRUCTIONS, criteria: VARIANT === "bare" ? BARE : CRITERIA,
  accuracy_5class: accuracy5, gate_accuracy: gateAccuracy, per_label: perLabel, confusion,
  latency_ms: { p50: r3(pct(lat, 0.5)), p95: r3(pct(lat, 0.95)), max: r3(Math.max(...lat)), min: r3(Math.min(...lat)) },
  retries: rows.reduce((s, r) => s + r.retries, 0),
  cost: { input_tokens_total: tokens, input_tokens_mean: r3(tokens / rows.length), usd_per_request: USD_PER_INPUT_TOKEN * tokens / rows.length, usd_total: USD_PER_INPUT_TOKEN * tokens },
  threshold_policy: thresholdTable, pipeline_rules_then_jev: pipelineTable,
  misclassified: rows.filter((r) => r.label !== r.pred).map((r) => ({ id: r.id, label: r.label, pred: r.pred, confidence: r3(r.confidence), app: r.app, title: r.title, text: r.text, gate_wrong: !gateOk(r) })),
  device10: rows.filter((r) => r.device10).map((r) => ({ id: r.id, topic: r.device10!.topic, label: r.label, device: r.device10!.device, jev: r.pred, confidence: r3(r.confidence), gate_ok: gateOk(r) })),
  rows: rows.map((r) => ({ id: r.id, label: r.label, app: r.app, rule: r.rule, sent: r.sent, pred: r.pred, confidence: r3(r.confidence),
    probabilities: Object.fromEntries(Object.entries(r.probabilities).map(([k, v]) => [k, r3(v)])), ms: r3(r.ms), input_tokens: r.input_tokens })),
};
await Deno.writeTextFile(new URL(VARIANT === "bare" ? "../eval/jev-results-bare-prod.json" : "../eval/jev-results-prod.json", import.meta.url), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ accuracy_5class: accuracy5, gate_accuracy: gateAccuracy, per_label: perLabel, latency_ms: result.latency_ms, cost: result.cost, threshold_policy: thresholdTable, pipeline: pipelineTable }, null, 1));
