// 스펙 §9 평가 절차 3: 질문마다 배포된 chat 을 실사용자 JWT 로 부른다. stdout 에는 id·Top-5 id·정답 순위·거절·인용 적중·지연만, 답변 본문은 eval/answers.local.json 에만.
// 실사용자 JWT 는 Auth admin 매직링크 해시로 만든 세션(Ruling 13, 메모리에만, 출력 금지, 끝나면 이 세션만 로그아웃). 에이전트는 answers.local.json 을 열지 않는다(AGENTS.md §7)
// --check: 질문 파일 검증과 태그 개수만(네트워크 없음). --user: 테스트 사용자로 도구 확인(기본 ERURI_USER_ID)
// 사용: deno run --allow-net --allow-env --allow-read --allow-write --env-file=supabase/.env supabase/scripts/eval-search.ts [--questions supabase/eval/questions.json] [--check] [--user <uuid>]
import { createClient } from "npm:@supabase/supabase-js@2";
import { SERVER_AUTH } from "../functions/_shared/crypto.ts";
import { type Question, scoreQuestion, summarize, tagCounts, validateQuestions } from "../eval/eval-lib.ts";

const arg = (k: string) => { const i = Deno.args.indexOf(k); return i >= 0 ? Deno.args[i + 1] : undefined; };
const qPath = arg("--questions") ?? new URL("../eval/questions.json", import.meta.url);
const raw = await Deno.readTextFile(qPath).catch(() => null);
if (raw === null) { console.error("질문 파일 없음 — 형식은 supabase/eval/questions.example.json"); Deno.exit(2); }
const questions: Question[] = JSON.parse(raw).questions;
const violations = validateQuestions(questions);
if (violations.length) { console.log(JSON.stringify({ invalid_questions: violations })); Deno.exit(2); }
if (Deno.args.includes("--check")) { console.log(JSON.stringify({ valid: true, questions: questions.length, tags: tagCounts(questions) })); Deno.exit(0); }

const user = arg("--user") ?? Deno.env.get("ERURI_USER_ID");
if (!user) { console.error("ERURI_USER_ID 없음"); Deno.exit(2); }
const BASE = Deno.env.get("SUPABASE_URL")!, ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const admin = createClient(BASE, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, SERVER_AUTH);
const { data: u, error: ue } = await admin.auth.admin.getUserById(user);
if (ue || !u.user?.email) { console.error("사용자 이메일 없음 — M1-②c Apple 로그인 이메일 범위 확인", ue?.code ?? ""); Deno.exit(2); }
const { data: link, error: le } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.user.email });
if (le) throw new Error("generateLink " + le.code);
const userClient = createClient(BASE, ANON, SERVER_AUTH);
const { data: v, error: ve } = await userClient.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
if (ve || !v.session) throw new Error("verifyOtp " + ve?.code);
const headers = { authorization: `Bearer ${v.session.access_token}`, apikey: ANON, "content-type": "application/json" };

// 503 llm_busy 는 앱처럼 잠깐 기다렸다 한 번 더. 그래도 실패한 질문은 http_errors 로 세고 합격에서 뺀다(오류를 거절로 채점하지 않게)
async function ask(question: string): Promise<Response> {
  const call = () => fetch(`${BASE}/functions/v1/chat`, { method: "POST", headers, body: JSON.stringify({ question }) });
  const r = await call();
  if (r.status !== 503) return r;
  await r.body?.cancel();
  await new Promise((ok) => setTimeout(ok, 5000));
  return call();
}

const answers: Record<string, unknown> = {};
const scores = [];
let httpErrors = 0;
try {
  for (const q of questions) {
    const t0 = performance.now();
    const r = await ask(q.question);
    const ms = Math.round(performance.now() - t0);
    const j = r.ok ? await r.json() : (await r.body?.cancel(), { hits: [], refused: true, source_item_ids: [], answer: `http ${r.status}` });
    if (!r.ok) httpErrors++;
    answers[q.id] = { answer: j.answer, answer_id: j.answer_id, source_item_ids: j.source_item_ids };
    const hits: string[] = j.hits ?? [];
    const s = { ...scoreQuestion(q, { hits, refused: j.refused, source_item_ids: j.source_item_ids ?? [], ms }), kind: q.kind, tags: q.tags };
    scores.push(s);
    const rank = hits.findIndex((h) => q.expected_item_ids.includes(h)) + 1;
    console.log([q.id, `top5=${s.top5}`, `rank=${rank || "-"}`, `refused=${s.refused}`, `expected_refusal=${q.kind === "no_answer"}`,
      `cited_expected=${s.cited_expected}`, `date_miss=${s.date_filter_miss}`, `${ms}ms`, `top5_ids=${hits.slice(0, 5).join(",")}`,
      ...(q.tags?.length ? [`tags=${q.tags.join(",")}`] : []), ...(r.ok ? [] : [`http=${r.status}`])].join("\t"));
  }
} finally {
  await userClient.auth.signOut({ scope: "local" });                  // 이 평가 세션만. global 은 사용자 기기 세션까지 끊는다
}
await Deno.writeTextFile(new URL("../eval/answers.local.json", import.meta.url), JSON.stringify(answers, null, 1) + "\n");
const sum = summarize(scores);
console.log(JSON.stringify({ ...sum, http_errors: httpErrors, pass: sum.pass && httpErrors === 0 }));
