import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

// purge-media 시스템 잡(스펙 §8 원문 만료: Storage 객체). storage_key = '<bucket>/<user_id>/<파일>'. 로그는 개수만
export async function purgeMedia(sb: SupabaseClient): Promise<string> {
  const { data, error } = await sb.rpc("worker_expired_media", { p_limit: 100 });
  if (error) throw new Error("worker_expired_media " + error.code);
  let removed = 0;
  for (const r of data as { user_id: string; item_id: string; storage_key: string }[]) {
    const [bucket, ...rest] = r.storage_key.split("/");
    const { error: e } = await sb.storage.from(bucket).remove([rest.join("/")]);
    if (e) continue;
    await sb.rpc("worker_clear_storage_key", { p_user: r.user_id, p_item: r.item_id });
    removed++;
  }
  console.log(JSON.stringify({ purge_media: removed }));
  return "purged";
}
