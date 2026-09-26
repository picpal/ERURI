// 잡을 처리하는 동안 intervalMs마다 beat를 호출해 임대를 연장한다. 끝나면(성공·실패 모두) 멈춘다
export const HEARTBEAT_MS = 30_000;

export async function withHeartbeat<T>(beat: () => Promise<unknown>, run: () => Promise<T>, intervalMs = HEARTBEAT_MS): Promise<T> {
  const timer = setInterval(() => { beat().catch(() => {}); }, intervalMs);
  try {
    return await run();
  } finally {
    clearInterval(timer);
  }
}
