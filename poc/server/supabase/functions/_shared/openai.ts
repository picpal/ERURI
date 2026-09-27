import OpenAI from "npm:openai@7";
// Responses API·임베딩 공용 클라이언트(Task 11·12). Edge 벽시계 150초 안에 끝나도록 SDK 기본값(타임아웃 10분·재시도 2회)을 줄인다.
// 모든 Responses 호출은 store: false(스펙 §12 통제 3). 로그에 요청·응답 본문을 남기지 않는다
export const openai = new OpenAI({ apiKey: Deno.env.get("OPENAI_API_KEY")!, timeout: 60_000, maxRetries: 1 });
