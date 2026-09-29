import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { sendAPNs } from "../_shared/apns.ts";
import type { ProposalRow } from "../_shared/notify.ts";
import type { Device, NotifyDeps } from "./notify.ts";

// notify 잡의 실제 의존성(service role). 모든 RPC에 user_id를 명시한다(스펙 §12 통제 4)
export function notifyDeps(sb: SupabaseClient, o: Partial<Pick<NotifyDeps, "send" | "topic" | "now">> = {}): NotifyDeps {
  return {
    async getProposal(userId, proposalId) {
      const { data, error } = await sb.rpc("worker_get_proposal", { p_user: userId, p_proposal: proposalId });
      if (error) throw new Error("worker_get_proposal " + error.code);
      return (data as ProposalRow[])[0] ?? null;
    },
    async listDevices(userId) {
      const { data, error } = await sb.rpc("worker_list_devices", { p_user: userId });
      if (error) throw new Error("worker_list_devices " + error.code);
      return data as Device[];
    },
    async claimPush(userId, proposalId, deviceId) {
      const { data, error } = await sb.rpc("claim_proposal_push", { p_user: userId, p_proposal: proposalId, p_device: deviceId });
      if (error) throw new Error("claim_proposal_push " + error.code);
      return data === true;
    },
    async finishPush(userId, proposalId, deviceId, r) {
      const { error } = await sb.rpc("finish_proposal_push", { p_user: userId, p_proposal: proposalId, p_device: deviceId, p_status: r.status,
        p_apns_status: r.apnsStatus, p_reason: r.reason, p_apns_id: r.apnsId, p_env: r.env });
      if (error) throw new Error("finish_proposal_push " + error.code);
    },
    send: o.send ?? sendAPNs,
    topic: o.topic ?? (() => Deno.env.get("APNS_TOPIC")!),
    now: o.now ?? (() => new Date()),
  };
}
