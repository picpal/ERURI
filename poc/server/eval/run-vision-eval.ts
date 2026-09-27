// PoC-8 서버 부분(Task 12) 실측: 합성 7종(eval/images, gitignore)을 전용 테스트 사용자 경로로 Storage에 올리고
// 배포된 vision-extract를 모드별(vision / vision+ocr / ocr)로 호출해 정답(truth.json)과 대조. 지연·토큰·비용 집계.
// 사용: cd poc/server && deno run -A --env-file=.env eval/run-vision-eval.ts [반복=3]
// 출력: eval/out/vision-<시각>.json (합성 값만)
import { createClient } from "npm:@supabase/supabase-js@2";
import { SERVER_AUTH } from "../supabase/functions/_shared/crypto.ts";
import { testUser } from "../supabase/tests/_testenv.ts";

type Truth = { kind: "image" | "pdf"; title: string[]; start: string; end?: string; location: string; uncertain_expect: string[]; lunar?: boolean };
type Out = { title: string | null; start: string | null; end: string | null; location: string | null; uncertain: string[];
  usage?: { input_tokens: number; output_tokens: number }; model_ms?: number; error?: string };

const URL_ = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = createClient(URL_, KEY, SERVER_AUTH);
const dir = new URL("./images/", import.meta.url);
const truth: Record<string, Truth> = JSON.parse(await Deno.readTextFile(new URL("truth.json", dir)));
const ocr: Record<string, string> = JSON.parse(await Deno.readTextFile(new URL("ocr.json", dir)));
const reps = Number(Deno.args[0] ?? 3);
const user = (await testUser()).id;

// 업로드(덮어쓰기)
for (const name of Object.keys(truth)) {
  const bytes = await Deno.readFile(new URL(name, dir));
  const { error } = await sb.storage.from("poc").upload(`${user}/eval/${name}`, bytes,
    { upsert: true, contentType: name.endsWith(".pdf") ? "application/pdf" : "image/png" });
  if (error) throw new Error("upload " + name + " " + error.message);
}

const sameInstant = (a: string | null, b: string) => a !== null && a.length > 10 && Date.parse(a) === Date.parse(b);
function score(name: string, o: Out) {
  const t = truth[name];
  const title = o.title !== null && t.title.every((k) => o.title!.includes(k));
  const startExact = sameInstant(o.start, t.start);
  // 음력: 양력 환산이 맞거나, 확신 없음(date)을 표시했으면 허용(사용자 확인 경로)
  const start = startExact || (t.lunar === true && o.uncertain.includes("date"));
  const location = o.location !== null && o.location.replace(/\s/g, "").includes(t.location.replace(/\s/g, ""));
  const end = t.end === undefined ? true : sameInstant(o.end, t.end);
  const uncertainHit = t.uncertain_expect.every((u) => o.uncertain.includes(u));
  const extraUncertain = o.uncertain.filter((u) => !t.uncertain_expect.includes(u));
  return { title, start, startExact, location, end, uncertainHit, extraUncertain, all: title && start && location };
}

const modes = ["vision", "vision+ocr", "ocr"] as const;
const rows: Record<string, unknown>[] = [];
for (let r = 0; r < reps; r++) {
  for (const mode of modes) {
    for (const name of Object.keys(truth)) {
      const body = mode === "ocr" ? { ocrText: ocr[name] } : { storagePath: `poc/${user}/eval/${name}`, ...(mode === "vision+ocr" ? { ocrText: ocr[name] } : {}) };
      const t0 = performance.now();
      const res = await fetch(`${URL_}/functions/v1/vision-extract`, { method: "POST", headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" }, body: JSON.stringify(body) });
      const wall = Math.round(performance.now() - t0);
      const o = (await res.json()) as Out;
      rows.push({ rep: r, mode, name, status: res.status, wall_ms: wall, ...o, score: res.ok ? score(name, o) : null });
      console.log(JSON.stringify({ rep: r, mode, name, status: res.status, wall, model_ms: o.model_ms, ok: res.ok ? score(name, o).all : false }));
    }
  }
}

const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]; };
const summary: Record<string, unknown> = {};
for (const mode of modes) {
  const rs = rows.filter((x) => x.mode === mode && x.status === 200) as (Out & { name: string; wall_ms: number; score: ReturnType<typeof score> })[];
  const perFile: Record<string, string> = {};
  for (const name of Object.keys(truth)) {
    const f = rs.filter((x) => x.name === name);
    const c = (k: keyof ReturnType<typeof score>) => f.filter((x) => x.score[k] === true).length;
    perFile[name] = `title ${c("title")}/${f.length} start ${c("start")}/${f.length}(exact ${c("startExact")}) loc ${c("location")}/${f.length} end ${c("end")}/${f.length} unc ${c("uncertainHit")}/${f.length} extra[${[...new Set(f.flatMap((x) => x.score.extraUncertain))].join(",")}]`;
  }
  const inT = rs.map((x) => x.usage?.input_tokens ?? 0), outT = rs.map((x) => x.usage?.output_tokens ?? 0);
  const avgIn = inT.reduce((a, b) => a + b, 0) / rs.length, avgOut = outT.reduce((a, b) => a + b, 0) / rs.length;
  summary[mode] = {
    n: rs.length, errors: rows.filter((x) => x.mode === mode && x.status !== 200).length,
    all_ok: `${rs.filter((x) => x.score.all).length}/${rs.length}`,
    wall_p50: pct(rs.map((x) => x.wall_ms), 0.5), wall_p95: pct(rs.map((x) => x.wall_ms), 0.95),
    model_p50: pct(rs.map((x) => x.model_ms ?? 0), 0.5), model_p95: pct(rs.map((x) => x.model_ms ?? 0), 0.95),
    avg_input_tokens: Math.round(avgIn), avg_output_tokens: Math.round(avgOut),
    usd_per_call: Number(((avgIn * 0.10 + avgOut * 0.50) / 1e6).toFixed(6)),
    per_file: perFile,
  };
}
console.log(JSON.stringify(summary, null, 1));
await Deno.mkdir(new URL("./out/", import.meta.url), { recursive: true });
await Deno.writeTextFile(new URL(`./out/vision-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "")}.json`, import.meta.url),
  JSON.stringify({ summary, rows }, null, 1));
