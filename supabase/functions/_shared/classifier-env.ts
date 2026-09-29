import { type Classifier, noneClassifier } from "./classify.ts";
import { jevClassifier, jevHttpTransport } from "./jev.ts";

// CLASSIFY_PROVIDER=none|jev|openai → Classifier (스펙 §7 0b). 어댑터를 import 하는 곳은 여기뿐이라 순환 import 가 없다
type Env = (k: string) => string | undefined;

export function classifierFromEnv(env: Env, fetchFn: typeof fetch = fetch): Classifier {
  const p = env("CLASSIFY_PROVIDER") ?? "none";
  if (p === "none") return noneClassifier;
  if (p === "jev") {
    const key = env("JEV_API_KEY");
    if (!key) throw new Error("classify jev_key_missing");
    return jevClassifier({ transport: jevHttpTransport({ apiKey: key, fetchFn }) });
  }
  if (p === "openai") throw new Error("classify openai_not_built");
  throw new Error("classify unknown_provider");
}

// worker 용: 설정 오류로 워커 전체가 멈추지 않게 none 으로 돌고 코드만 남긴다
export function classifierOrNone(env: Env, log: (s: string) => void = console.log): Classifier {
  try {
    return classifierFromEnv(env);
  } catch (e) {
    log(JSON.stringify({ classify_config: e instanceof Error ? e.message : "error" }));
    return noneClassifier;
  }
}
