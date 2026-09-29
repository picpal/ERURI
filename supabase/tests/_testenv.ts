import { createClient } from "npm:@supabase/supabase-js@2";
import { SERVER_AUTH } from "../functions/_shared/crypto.ts";

// 호스팅 DB 테스트 격리(AGENTS.md §7): 테스트는 전용 테스트 사용자와 실행 태그로 자기 행만 만들고 지운다.
// 실측 데이터(ERURI_USER_ID(제품)·POC_USER_ID(PoC)의 items·jobs·connections)는 건드리지 않는다. 조건 없는 delete·truncate 금지.
export const RUN = "test:" + crypto.randomUUID().slice(0, 8);               // lease_key·idempotency_key·device_id 접두
export const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, SERVER_AUTH);

export type TestUser = { id: string; email: string; password: string };
const cache = new Map<string, Promise<TestUser>>();

// poc-test-<n>@example.com 을 찾거나 만들고, 실행마다 새 비밀번호를 건다(비밀번호는 저장하지 않는다)
export function testUser(n = 1): Promise<TestUser> {
  const email = `poc-test-${n}@example.com`;
  let p = cache.get(email);
  if (!p) {
    p = (async () => {
      const password = crypto.randomUUID() + "Aa1!";
      const { data, error } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (error) throw new Error("listUsers " + error.code);
      const found = data.users.find((u) => u.email === email);
      if (found) {
        const up = await service.auth.admin.updateUserById(found.id, { password });
        if (up.error) throw new Error("updateUser " + up.error.code);
        return { id: found.id, email, password };
      }
      const cr = await service.auth.admin.createUser({ email, password, email_confirm: true });
      if (cr.error || !cr.data.user) throw new Error("createUser " + cr.error?.code);
      return { id: cr.data.user.id, email, password };
    })();
    cache.set(email, p);
  }
  return p;
}

// 이번 실행이 만든 잡만 지운다
export async function deleteRunJobs(prefix = RUN) {
  const { error } = await service.from("jobs").delete().like("lease_key", prefix + "%");
  if (error) throw new Error("delete jobs " + error.code);
}

// 사용자 JWT 클라이언트(RLS·authenticated RPC 테스트). 비밀번호는 testUser 가 실행마다 새로 건다
export async function userClient(n = 1) {
  const u = await testUser(n);
  const c = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, SERVER_AUTH);
  const { error } = await c.auth.signInWithPassword({ email: u.email, password: u.password });
  if (error) throw new Error("signin " + error.code);
  return { u, c };
}
