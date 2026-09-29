import { type APNsResult, type ApnsEnv, type ApnsPushType, sendWithEnvFallback } from "../_shared/apns.ts";
import type { Job } from "../_shared/job.ts";
import { isPermanentFailure, planProposalPush, type ProposalRow } from "../_shared/notify.ts";

// notify 잡(스펙 §7 0b): 제안 1건을 사용자의 모든 기기에 기기별 1회 보낸다. 로그에는 코드·개수만(토큰·문구 금지)
export type Device = { device_id: string; apns_token: string; apns_env: ApnsEnv };
export type PushRecord = { status: "sent" | "failed" | "rejected"; apnsStatus: number | null; reason: string | null; apnsId: string | null; env: ApnsEnv | null };
export type NotifyDeps = {
  getProposal(userId: string, proposalId: string): Promise<ProposalRow | null>;
  listDevices(userId: string): Promise<Device[]>;
  claimPush(userId: string, proposalId: string, deviceId: string): Promise<boolean>;
  finishPush(userId: string, proposalId: string, deviceId: string, r: PushRecord): Promise<void>;
  send(o: { token: string; payload: unknown; topic: string; env: ApnsEnv; priority?: 5 | 10; pushType?: ApnsPushType }): Promise<APNsResult>;
  topic(): string;
  now(): Date;
};

export async function notifyProposal(deps: NotifyDeps, job: Job): Promise<string> {
  if (!job.user_id) throw new Error("notify job without user_id");
  const user = job.user_id, pid = String(job.payload.proposal_id);
  const p = await deps.getProposal(user, pid);
  if (!p) return log(job, "skipped", { reason: "not_found" });
  const plan = planProposalPush(p, deps.now());
  if (plan.skip !== null) return log(job, "skipped", { reason: plan.skip });
  const devices = await deps.listDevices(user);
  const n = { sent: 0, rejected: 0, failed: 0, already: 0 };
  for (const d of devices) {
    if (!(await deps.claimPush(user, pid, d.device_id))) { n.already++; continue; }
    const rec = await sendOne(deps, d, plan.payload);
    await deps.finishPush(user, pid, d.device_id, rec);
    n[rec.status]++;
  }
  const cp = devices.length === 0 ? "no_device" : "notified";
  log(job, cp, { category: plan.category, devices: devices.length, ...n });
  if (n.failed > 0) throw new Error(`notify transient ${n.failed}`);   // failed 행만 다음 시도에서 다시 보낸다
  return cp;
}

async function sendOne(deps: NotifyDeps, d: Device, payload: Record<string, unknown>): Promise<PushRecord> {
  try {
    const r = await sendWithEnvFallback(deps.send, { token: d.apns_token, payload, topic: deps.topic(), env: d.apns_env });
    if (r.status === 200) return { status: "sent", apnsStatus: 200, reason: null, apnsId: r.apnsId ?? null, env: r.env };
    return { status: isPermanentFailure(r) ? "rejected" : "failed", apnsStatus: r.status, reason: r.reason ?? null, apnsId: r.apnsId ?? null, env: r.env };
  } catch {
    return { status: "failed", apnsStatus: null, reason: "network", apnsId: null, env: null };   // GOAWAY 등 연결 오류(스펙 §3)
  }
}

function log(job: Job, checkpoint: string, m: Record<string, unknown>): string {
  console.log(JSON.stringify({ job_id: job.id, proposal_id: job.payload.proposal_id, checkpoint, ...m }));
  return checkpoint;
}
