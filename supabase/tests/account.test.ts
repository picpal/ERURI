import { assertEquals, assertRejects } from "jsr:@std/assert";
import { type AccountDeps, handleAccount } from "../functions/account/handler.ts";
import { removeUserStorage } from "../functions/account/deps.ts";

function fake(o: { conns?: string[]; revokeFails?: boolean; wipeFails?: boolean; storageFails?: boolean; deleteUserFails?: boolean;
  auditFails?: boolean; noToken?: string[] } = {}) {
  const calls: string[] = [];
  const d: AccountDeps = {
    authUser: async (t) => (t === "user-jwt" ? "u1" : null),
    connections: async () => o.conns ?? ["c1"],
    refreshToken: async (_u, c) => (o.noToken?.includes(c) ? null : `rt-${c}`),
    revoke: async (t) => { calls.push("revoke:" + t); if (o.revokeFails) throw new Error("revoke 400"); },
    deleteGmailSource: async (_u, c) => { calls.push("source:" + c); return { items: 2, facts: 1, jobs: 3 }; },
    listDevices: async () => { calls.push("list_devices"); return [{ apns_token: "t1", apns_env: "sandbox" }]; },
    wipe: async (ds) => { calls.push("wipe:" + ds.map((x) => x.apns_token).join(",")); if (o.wipeFails) throw new Error("apns"); return 1; },
    removeStorage: async () => { calls.push("storage"); if (o.storageFails) throw new Error("storage_list"); return 0; },
    audit: async (_u, a) => { calls.push("audit:" + a); if (o.auditFails) throw new Error("account_audit 500"); },
    deleteUser: async () => { calls.push("delete_user"); if (o.deleteUserFails) throw new Error("delete_user 500"); },
  };
  return { d, calls };
}
const req = (path: string, body?: unknown, token: string | null = "user-jwt", method = "POST") => new Request(`http://x/account/${path}`, {
  method, body: body === undefined ? undefined : JSON.stringify(body), headers: token ? { authorization: `Bearer ${token}` } : {} });

Deno.test("account: 401 without user JWT; 405 non-POST; 404 unknown path; 400 unknown provider", async () => {
  const { d, calls } = fake();
  assertEquals((await handleAccount(req("delete", undefined, null), d)).status, 401);
  assertEquals((await handleAccount(req("delete", undefined, "user-jwt", "GET"), d)).status, 405);
  assertEquals((await handleAccount(req("nope"), d)).status, 404);
  assertEquals((await handleAccount(req("source", { provider: "outlook" }), d)).status, 400);
  assertEquals(calls, []);
});

Deno.test("account/source gmail: revoke then delete each connection; a failed revoke does not stop deletion", async () => {
  const { d, calls } = fake({ conns: ["c1", "c2"], revokeFails: true });
  const r = await handleAccount(req("source", { provider: "gmail" }), d);
  assertEquals(r.status, 200);
  assertEquals(calls, ["revoke:rt-c1", "revoke:rt-c2", "source:c1", "source:c2"]);
  assertEquals(await r.json(), { provider: "gmail", connections: 2, revoked: 0, revoke_failed: 2, revoke_skipped: 0,
    deleted: [{ items: 2, facts: 1, jobs: 3 }, { items: 2, facts: 1, jobs: 3 }] });
});

// 리뷰 #1b: 연결이 이미 없어도(삭제 직후 fetch 가 되살린 항목) 버튼 재시도로 Gmail 항목을 지운다
Deno.test("account/source gmail with no connections left still deletes the user's Gmail items once", async () => {
  const { d, calls } = fake({ conns: [] });
  const r = await handleAccount(req("source", { provider: "gmail" }), d);
  assertEquals(r.status, 200);
  assertEquals(calls, ["source:null"]);
  assertEquals((await r.json()).deleted, [{ items: 2, facts: 1, jobs: 3 }]);
});

Deno.test("account/source: a connection without an active token is counted as revoke_skipped", async () => {
  const { d } = fake({ conns: ["c1", "c2"], noToken: ["c2"] });
  const b = await (await handleAccount(req("source", { provider: "gmail" }), d)).json();
  assertEquals([b.revoked, b.revoke_failed, b.revoke_skipped], [1, 0, 1]);
});

// 리뷰 #2: 기기 목록 선조회 → revoke → Storage → 사용자 삭제 → 감사 → 보관한 토큰으로 wipe
Deno.test("account/delete: list devices → revoke → storage → delete user → audit → wipe; wipe failure does not block", async () => {
  const { d, calls } = fake({ wipeFails: true });
  const r = await handleAccount(req("delete"), d);
  assertEquals(r.status, 200);
  assertEquals(calls, ["list_devices", "revoke:rt-c1", "storage", "delete_user", "audit:account_delete", "wipe:t1"]);
  assertEquals((await r.json()).devices_wiped, 0);
});

Deno.test("account/delete: deleteUser failure → 500, no wipe push and no audit row", async () => {
  const { d, calls } = fake({ deleteUserFails: true });
  await assertRejects(() => handleAccount(req("delete"), d));
  assertEquals(calls.some((c) => c.startsWith("wipe") || c.startsWith("audit")), false);
});

// 리뷰 #3: Storage 오류면 사용자 삭제 전에 멈춘다
Deno.test("account/delete: storage failure stops before deleteUser", async () => {
  const { d, calls } = fake({ storageFails: true });
  await assertRejects(() => handleAccount(req("delete"), d));
  assertEquals(calls, ["list_devices", "revoke:rt-c1", "storage"]);
});

Deno.test("account/delete: audit failure after the user is gone still wipes devices and returns 200", async () => {
  const { d, calls } = fake({ auditFails: true });
  assertEquals((await handleAccount(req("delete"), d)).status, 200);
  assertEquals(calls.at(-1), "wipe:t1");
});

type Entry = { name: string; id: string | null };
function fakeStorage(tree: Record<string, Entry[]>, o: { listError?: boolean; removeError?: boolean } = {}) {
  const removed: string[][] = [];
  const bucket = {
    list: async (dir: string, { limit, offset }: { limit: number; offset: number }) =>
      o.listError ? { data: null, error: { name: "StorageApiError" } } : { data: (tree[dir] ?? []).slice(offset, offset + limit), error: null },
    remove: async (paths: string[]) => { removed.push(paths); return o.removeError ? { data: null, error: { name: "StorageApiError" } } : { data: [], error: null }; },
  };
  // deno-lint-ignore no-explicit-any
  return { sb: { storage: { from: () => bucket } } as any, removed };
}

Deno.test("removeUserStorage: walks subfolders and pages past 1000, removes in batches of 1000", async () => {
  const many = Array.from({ length: 1001 }, (_, i) => ({ name: `f${i}`, id: `id${i}` }));
  const { sb, removed } = fakeStorage({ u1: [...many, { name: "sub", id: null }], "u1/sub": [{ name: "g", id: "g" }] });
  assertEquals(await removeUserStorage(sb, "u1"), 1002);
  assertEquals(removed.map((b) => b.length), [1000, 2]);
  assertEquals(removed[1], ["u1/f1000", "u1/sub/g"]);
});

Deno.test("removeUserStorage: list or remove error throws", async () => {
  await assertRejects(() => removeUserStorage(fakeStorage({ u1: [] }, { listError: true }).sb, "u1"), Error, "storage_list");
  await assertRejects(() => removeUserStorage(fakeStorage({ u1: [{ name: "a", id: "a" }] }, { removeError: true }).sb, "u1"), Error, "storage_remove");
});
