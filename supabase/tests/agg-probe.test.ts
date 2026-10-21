import { assertEquals } from "jsr:@std/assert";
import { type ProbeCase, type ProbeFile, probeRow, summarizeProbe, validateProbeCases } from "../scripts/_agg-probe.ts";

const file = JSON.parse(await Deno.readTextFile(new URL("../eval/agg-probe-cases.json", import.meta.url))) as ProbeFile;

Deno.test("validateProbeCases: the committed probe file passes — every case is gated to 0.17.0 and expects an existing intent", () => {
  assertEquals(validateProbeCases(file), []);
  const noCue: ProbeCase = { id: "x1", text: "내일 3시 합성치과 등록해줘", intent: "add_event" };       // 단서·직전 집계 없음 → 0.16.x 바이트 동일
  const newIntent: ProbeCase = { id: "x2", text: "앞으로 합성PAY 문자는 저장해", intent: "save_rule_add" };
  assertEquals(validateProbeCases({ today: file.today, cases: [noCue, newIntent, { ...file.cases[0] }, { ...file.cases[0] }] }),
    ["x1 not gated to 0.17.0", "x2 expected intent must be an existing one", "p01 duplicate"]);
});

Deno.test("probeRow/summarizeProbe: aggregate without keywords counts as question for got but stays wrong for model; pass needs 0.17 model misfires 0", () => {
  const c = file.cases.find((x) => x.id === "p03")!;
  const a = probeRow(c, "0.17", "aggregate", { keywords: [], sender: null, sources: [], from: null, to: null, bucket: null }, file.today);
  assertEquals([a.got, a.model], ["question", "aggregate"]);
  const ok = probeRow(c, "0.17", "question", null, file.today), base = probeRow(c, "0.16", "add_event", null, file.today);
  assertEquals(summarizeProbe([base, ok]).pass, true);
  const s = summarizeProbe([base, ok, a]);
  assertEquals([s.pass, s.next.model_wrong, s.next.got_wrong, s.next.to_new_intents, s.baseline.got_wrong], [false, ["p03:aggregate"], [], 1, ["p03:add_event"]]);
});
