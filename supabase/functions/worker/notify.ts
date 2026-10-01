import { type APNsResult, type ApnsEnv, type ApnsPushType, sendWithEnvFallback } from "../_shared/apns.ts";
import type { Job } from "../_shared/job.ts";
import { isPermanentFailure, type PeerProposal, planBundlePush, type ProposalRow } from "../_shared/notify.ts";

// notify 잡(스펙 §7 0b): 항목의 제안(묶음)을 사용자의 모든 기기에 기기별 1회 보낸다. 로그에는 코드·개수만(토큰·문구 금지)
export type Device = { device_id: string; apns_token: string; apns_env: ApnsEnv };
// claimed: 이 시도가 보낸다. closed: sent·rejected. in_flight: 잡 임대(180초) 안의 sending — 다른 시도가 보내는 중이거나 막 죽었다
export type Claim = "claimed" | "closed" | "in_flight";
export type PushRecord = { status: "sent" | "failed" | "rejected"; apnsStatus: number | null; reason: string | null; apnsId: string | null; env: ApnsEnv | null };
export type NotifyDeps = {
  getProposal(userId: string, proposalId: string): Promise<ProposalRow | null>;
  getBundle(userId: string, proposalId: string): Promise<ProposalRow[]>;
  /** 같은 사용자의 다른 항목에 먼저 생긴 대기 일정 제안 중 이 항목 일정과 같은 서울 시작 날짜인 것(0027) */
  getPeers(userId: string, proposalId: string): Promise<PeerProposal[]>;
  listDevices(userId: string): Promise<Device[]>;
  claimPush(userId: string, proposalId: string, deviceId: string): Promise<Claim>;
  finishPush(userId: string, proposalId: string, deviceId: string, r: PushRecord): Promise<void>;
  send(o: { token: string; payload: unknown; topic: string; env: ApnsEnv; priority?: 5 | 10; pushType?: ApnsPushType }): Promise<APNsResult>;
  topic(): string;
  now(): Date;
};

export async function notifyProposal(deps: NotifyDeps, job: Job): Promise<string> {
  if (!job.user_id) throw new Error("notify job without user_id");
  const user = job.user_id, pid = String(job.payload.proposal_id);
  const rows = await deps.getBundle(user, pid);                    // 대표 제안의 항목에 딸린 제안들(순번 순, 0025)
  if (rows.length === 0) return log(job, "skipped", { reason: "not_found" });
  // 대표 status 로 거르지 않는다 — 대표가 이미 처리돼도 미처리 형제가 남으면 보낸다(worker_unpushed_proposals 가 대표 id 를 돌려준다)
  // 서버 중복(§7 notify, 0.9.2): 못 읽으면 중복 없음으로 보고 보낸다(fail-open — 중복 푸시가 푸시 유실보다 싸다. 앱의 "비슷한 일정" 확인이 받친다)
  let peers: PeerProposal[] = [], peersError: string | null = null;
  try { peers = await deps.getPeers(user, pid); } catch (e) { peersError = e instanceof Error ? e.message.slice(0, 80) : "error"; }
  const plan = planBundlePush(rows, deps.now(), peers);
  if (plan.skip !== null) return log(job, "skipped", { reason: plan.skip, ...(peersError ? { peers_error: peersError } : {}) });
  const devices = await deps.listDevices(user);
  const n = { sent: 0, rejected: 0, failed: 0, already: 0, in_flight: 0 };
  for (const d of devices) {
    const c = await deps.claimPush(user, pid, d.device_id);
    if (c === "closed") { n.already++; continue; }
    if (c === "in_flight") { n.in_flight++; continue; }
    const rec = await sendOne(deps, d, plan.payload);
    await deps.finishPush(user, pid, d.device_id, rec);
    n[rec.status]++;
  }
  const cp = devices.length === 0 ? "no_device" : "notified";
  const events = Array.isArray(plan.payload.events) ? plan.payload.events.length : 1;
  log(job, cp, { category: plan.category, events, devices: devices.length, ...n, ...(peersError ? { peers_error: peersError } : {}) });
  // failed 행과 임대가 지난 sending 행을 다음 시도에서 다시 보낸다. in_flight 를 성공으로 끝내면 그 기기는 영영 못 받는다
  if (n.failed + n.in_flight > 0) throw new Error(`notify transient failed=${n.failed} in_flight=${n.in_flight}`);
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
