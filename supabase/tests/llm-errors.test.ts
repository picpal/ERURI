import { assert, assertEquals } from "jsr:@std/assert";
import OpenAI from "npm:openai@7";
import { errorCode, LLM_UNAVAILABLE_DEFER_MS, llmUnavailable, redactKeys } from "../functions/_shared/llm-errors.ts";

// 스펙 §7 jobs 워커 "LLM 사용 불가"(0.16.1): 401·403·429 insufficient_quota 만 사용 불가, 일반 429 rate limit·그 밖은 null
const h = new Headers();
const auth = new OpenAI.AuthenticationError(401, { code: "invalid_api_key" }, "Incorrect API key provided: sk-inv*********test", h);
const perm = new OpenAI.PermissionDeniedError(403, { code: "unsupported_country_region_territory" }, "denied", h);
const quota = new OpenAI.RateLimitError(429, { code: "insufficient_quota", type: "insufficient_quota" }, "quota", h);
const rate = new OpenAI.RateLimitError(429, { code: "rate_limit_exceeded", type: "requests" }, "slow down", h);

Deno.test("llmUnavailable: 401 llm_auth, 403 llm_permission, 429 insufficient_quota llm_quota; plain rate limit, 500, network and plain errors → null", () => {
  assertEquals([llmUnavailable(auth), llmUnavailable(perm), llmUnavailable(quota)], ["llm_auth", "llm_permission", "llm_quota"]);
  assertEquals(llmUnavailable(rate), null);
  assertEquals(llmUnavailable(new OpenAI.InternalServerError(500, { code: null }, "boom", h)), null);
  assertEquals(llmUnavailable(new OpenAI.APIConnectionError({ message: "fetch failed" })), null);
  assertEquals(llmUnavailable(new Error("invalid_api_key 401")), null);                     // 글자가 아니라 SDK 클래스로 가른다
  assertEquals(llmUnavailable(Object.assign(new Error("x"), { status: 401 })), null);
});

Deno.test("llmUnavailable: class and status must agree (a subclass instance with another status is not trusted)", () => {
  const odd = new OpenAI.AuthenticationError(400 as 401, { code: "invalid_api_key" }, "odd", h);   // 타입은 401 고정 — 런타임 값만 다르게
  assertEquals(llmUnavailable(odd), null);
});

Deno.test("errorCode: OpenAI errors become openai_<status> <code> without the message; connection errors openai_conn <class>", () => {
  assertEquals(errorCode(auth), "openai_401 invalid_api_key");
  assertEquals(errorCode(rate), "openai_429 rate_limit_exceeded");
  assertEquals(errorCode(new OpenAI.InternalServerError(500, undefined, "boom", h)), "openai_500 -");
  assertEquals(errorCode(new OpenAI.APIConnectionTimeoutError()), "openai_conn APIConnectionTimeoutError");
  assert(!errorCode(auth).includes("sk-"));
});

Deno.test("errorCode: other errors keep their message, with key-shaped strings masked, cut to 200", () => {
  assertEquals(errorCode(new Error("extract save_facts 23505")), "extract save_facts 23505");
  assertEquals(errorCode(new Error("x sk-proj-AbC_12-x*** y")), "x sk-*** y");
  assertEquals(errorCode("nope"), "error");
  assertEquals(errorCode(new Error("e".repeat(300))).length, 200);
  assertEquals(redactKeys("a sk-abc b sk-1.2*3 c"), "a sk-*** b sk-*** c");
});

Deno.test("LLM unavailable defer is 30 minutes", () => assertEquals(LLM_UNAVAILABLE_DEFER_MS, 30 * 60_000));

// SDK 계약(네트워크, 비용 0 — 가짜 키라 OpenAI 가 인증 단계에서 거절한다): 401 은 SDK 가 재시도하지 않아 fetch 1회, 1초대 안에 AuthenticationError.
// 메시지에는 키 조각이 들어 있다(그래서 errorCode 가 메시지를 버린다). OPENAI_CONTRACT=0 이면 건너뛴다(오프라인)
Deno.test({ name: "SDK contract (network): fake key → AuthenticationError on responses and embeddings, one fetch each, no retry", ignore: Deno.env.get("OPENAI_CONTRACT") === "0",
  fn: async () => {
    let fetches = 0;
    const client = new OpenAI({ apiKey: "sk-invalid-test", timeout: 10_000, maxRetries: 1,
      fetch: (input: RequestInfo | URL, init?: RequestInit) => { fetches++; return fetch(input, init); } });
    for (const call of [() => client.responses.create({ model: "gpt-6-luna", input: "합성", store: false }),
      () => client.embeddings.create({ model: "text-embedding-3-large", input: "합성", dimensions: 512 })]) {
      fetches = 0;
      const t0 = performance.now();
      const e = await call().then(() => null, (x) => x);
      const ms = performance.now() - t0;
      assert(e instanceof OpenAI.AuthenticationError, String(e?.constructor?.name));
      assertEquals([llmUnavailable(e), fetches, errorCode(e)], ["llm_auth", 1, "openai_401 invalid_api_key"]);
      assert(ms < 3000, `${Math.round(ms)} ms`);
    }
  } });
