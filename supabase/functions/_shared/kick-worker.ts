// 처리 작업이 생긴 직후 워커를 한 번 깨운다(스펙 §7 "작업자 즉시 호출", 0.8.1). pg_cron 매분 호출은 놓친 작업 회수용으로 그대로 둔다.
// 워커는 배치(최대 100초)를 다 돌고 응답하므로 기다리지 않는다: 짧게(3초) 기다린 뒤 끊고, 끊겨도 워커는 계속 돈다
// (cron 의 pg_net timeout 5초와 같은 방식). 같은 잡을 두 번 돌리지 않는 것은 claim_jobs(advisory 락·임대·lease_key당 1개)가 맡는다.
// 실패는 로그에 결과 코드만 — 본문·키·주소를 남기지 않는다
export const KICK_TIMEOUT_MS = 3000;

export type KickDeps = {
  url?: string;                     // 기본 SUPABASE_URL
  key?: string;                     // 기본 SUPABASE_SERVICE_ROLE_KEY(워커 isServiceCaller 가 받는 키)
  fetch?: typeof fetch;
  timeoutMs?: number;
  log?: (line: string) => void;
};

// 결과: ok(배치가 3초 안에 끝남) · started(3초 넘게 도는 중 — 정상) · http_<status> · error · no_env
export async function kickWorker(d: KickDeps = {}): Promise<string> {
  const url = d.url ?? Deno.env.get("SUPABASE_URL"), key = d.key ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  let result: string;
  if (!url || !key) result = "no_env";
  else {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), d.timeoutMs ?? KICK_TIMEOUT_MS);
    try {
      const r = await (d.fetch ?? fetch)(`${url.replace(/\/+$/, "")}/functions/v1/worker`, {
        method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: "{}", signal: ac.signal,
      });
      await r.body?.cancel();
      result = r.ok ? "ok" : `http_${r.status}`;
    } catch {
      result = ac.signal.aborted ? "started" : "error";
    } finally {
      clearTimeout(timer);
    }
  }
  if (result !== "ok" && result !== "started") (d.log ?? console.log)(JSON.stringify({ kick_worker: result }));
  return result;
}

type EdgeRuntimeLike = { waitUntil(p: Promise<unknown>): void };

// 응답을 막지 않게 띄운다: EdgeRuntime.waitUntil 이 있으면 응답 뒤에도 끝까지 기다리게 맡기고, 없으면(로컬·테스트) await 없이 띄운다
export function kickInBackground(d: KickDeps = {}): Promise<string> {
  const p = kickWorker(d).catch(() => "error");
  (globalThis as { EdgeRuntime?: EdgeRuntimeLike }).EdgeRuntime?.waitUntil(p);
  return p;
}
