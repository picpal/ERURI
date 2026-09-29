import { type APNsResult, type ApnsEnv, type ApnsPushType, sendWithEnvFallback } from "../_shared/apns.ts";
import type { Job } from "../_shared/job.ts";
import { isPermanentFailure } from "../_shared/notify.ts";

// gmail-reauth 잡(스펙 §7 재인증 푸시). 창마다 1회(claim_reauth_push). 문구에 계정 주소를 넣지 않는다(잠금화면). 로그는 코드·개수만
export type ReauthReason = "expiring" | "invalid_grant";
export type ReauthDeps = {
  claim(userId: string, connectionId: string, reason: ReauthReason, windowKey: string): Promise<boolean>;
  release(userId: string, connectionId: string, reason: ReauthReason, windowKey: string): Promise<void>;
  listDevices(userId: string): Promise<{ device_id: string; apns_token: string; apns_env: ApnsEnv }[]>;
  send(o: { token: string; payload: unknown; topic: string; priority?: 5 | 10; env: ApnsEnv; pushType?: ApnsPushType }): Promise<APNsResult>;
  topic(): string;
};

export function reauthPayload(reason: ReauthReason): Record<string, unknown> {
  const body = reason === "expiring" ? "Gmail 연결이 24시간 안에 만료됩니다. 앱에서 다시 연결하세요." : "Gmail 연결이 끊겼습니다. 앱에서 다시 연결하세요.";
  return { aps: { alert: { title: "Gmail 다시 연결 필요", body }, sound: "default" }, kind: "gmail_reauth", reason };
}

export async function reauthPush(deps: ReauthDeps, job: Job): Promise<string> {
  if (!job.user_id) throw new Error("gmail-reauth job without user_id");
  const conn = String(job.payload.connection_id), key = String(job.payload.window_key), reason = job.payload.reason;
  if (reason !== "expiring" && reason !== "invalid_grant") throw new Error("gmail-reauth bad_reason");
  if (!await deps.claim(job.user_id, conn, reason, key)) return log(job, "already_sent", {});
  const devices = await deps.listDevices(job.user_id);
  // 기기 0개면 창을 쓰지 않는다: 기록을 풀어 매시 cron 이 다시 넣고, 그 사이 등록한 기기가 받는다
  if (devices.length === 0) {
    await deps.release(job.user_id, conn, reason, key);
    return log(job, "no_device", { reason });
  }
  const n = { sent: 0, rejected: 0, failed: 0 };
  for (const d of devices) {
    try {
      const r = await sendWithEnvFallback(deps.send, { token: d.apns_token, payload: reauthPayload(reason), topic: deps.topic(), env: d.apns_env });
      if (r.status === 200) n.sent++; else if (isPermanentFailure(r)) n.rejected++; else n.failed++;
    } catch {
      n.failed++;
    }
  }
  if (n.sent === 0 && n.failed > 0) {
    await deps.release(job.user_id, conn, reason, key);
    throw new Error(`gmail-reauth transient failed=${n.failed}`);
  }
  // 전부 영구 거절(410 등)은 재시도해도 같으므로 창을 소비하되, 실제 도달 0건을 구분해 남긴다
  return log(job, n.sent > 0 ? "reauth_sent" : "reauth_rejected", { reason, devices: devices.length, ...n });
}

function log(job: Job, checkpoint: string, m: Record<string, unknown>): string {
  console.log(JSON.stringify({ job_id: job.id, connection_id: job.payload.connection_id, checkpoint, ...m }));
  return checkpoint;
}
