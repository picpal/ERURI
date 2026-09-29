import { assertEquals, assertNotEquals, assertRejects } from "jsr:@std/assert";
import { createEnvelope, fromBytea, type KeyStore, toBytea } from "../functions/_shared/crypto.ts";

function memStore(): KeyStore & { rows: Map<string, Uint8Array> } {
  const rows = new Map<string, Uint8Array>();
  return {
    rows,
    get: async (u) => rows.get(u) ?? null,
    putIfAbsent: async (u, w) => { if (!rows.has(u)) rows.set(u, w); return rows.get(u)!; },
  };
}
const randomKey = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const MASTER = randomKey();
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const TEXT = "합성 문구: 10월 2일 오후 3시 강남 치과 예약 확인";

Deno.test("round trip through bytea hex", async () => {
  const env = createEnvelope(memStore(), MASTER);
  const ct = await env.encrypt(A, TEXT);
  assertEquals(await env.decrypt(A, toBytea(ct)), TEXT);
  assertEquals(fromBytea(toBytea(ct)), ct);
});

Deno.test("same plaintext encrypts differently (random IV) and one key per user", async () => {
  const store = memStore();
  const env = createEnvelope(store, MASTER);
  assertNotEquals(toBytea(await env.encrypt(A, TEXT)), toBytea(await env.encrypt(A, TEXT)));
  assertEquals(store.rows.size, 1);
});

Deno.test("another user's key cannot decrypt", async () => {
  const env = createEnvelope(memStore(), MASTER);
  const ct = await env.encrypt(A, TEXT);
  await env.encrypt(B, "B 키 생성용 합성 문구");
  await assertRejects(() => env.decrypt(B, ct));
});

Deno.test("wrapped key copied to another user's row does not unwrap", async () => {
  const store = memStore();
  const ct = await createEnvelope(store, MASTER).encrypt(A, TEXT);
  store.rows.set(B, store.rows.get(A)!);
  await assertRejects(() => createEnvelope(store, MASTER).decrypt(B, ct));
});

Deno.test("wrong master key or deleted user_keys row cannot decrypt (crypto-shredding)", async () => {
  const store = memStore();
  const ct = await createEnvelope(store, MASTER).encrypt(A, TEXT);
  await assertRejects(() => createEnvelope(store, randomKey()).decrypt(A, ct));
  store.rows.delete(A);
  await assertRejects(() => createEnvelope(store, MASTER).decrypt(A, ct), Error, "no data key");
  assertEquals(store.rows.size, 0);       // 복호화 경로는 키를 새로 만들지 않는다
});
