import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

// 봉투 암호화 (스펙 §12 통제 1)
// wrapped_key = v1 || iv(12) || AES-256-GCM(MASTER_KEY, DEK, aad="user_keys:<userId>")
// content_enc = v1 || iv(12) || AES-256-GCM(DEK, plaintext, aad="items:<userId>")
export interface KeyStore {
  get(userId: string): Promise<Uint8Array | null>;
  putIfAbsent(userId: string, wrapped: Uint8Array): Promise<Uint8Array>;   // 경합 시 먼저 저장된 값을 반환
}

const VERSION = 1;
// WebCrypto 호출에는 .slice()로 ArrayBuffer 기반 복사본을 넘긴다(Deno 타입 검사: BufferSource)
const te = new TextEncoder(), td = new TextDecoder();

export function toBytea(b: Uint8Array): string {
  return "\\x" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
export function fromBytea(v: Uint8Array | string): Uint8Array {
  if (typeof v !== "string") return v;
  const hex = v.startsWith("\\x") ? v.slice(2) : v;
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) throw new Error("bytea: invalid hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function aesKey(raw: Uint8Array): Promise<CryptoKey> {
  if (raw.length !== 32) throw new Error("key must be 32 bytes");
  return await crypto.subtle.importKey("raw", raw.slice(), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
async function seal(key: CryptoKey, plain: Uint8Array, aad: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad.slice() }, key, plain.slice()));
  const out = new Uint8Array(13 + ct.length);
  out[0] = VERSION; out.set(iv, 1); out.set(ct, 13);
  return out;
}
async function open(key: CryptoKey, blob: Uint8Array, aad: Uint8Array): Promise<Uint8Array> {
  if (blob.length < 13 + 16 || blob[0] !== VERSION) throw new Error("ciphertext: bad format");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: blob.slice(1, 13), additionalData: aad.slice() }, key, blob.slice(13));
  return new Uint8Array(pt);
}

export function createEnvelope(store: KeyStore, masterKeyB64: string) {
  const master = aesKey(Uint8Array.from(atob(masterKeyB64), (c) => c.charCodeAt(0)));
  const cache = new Map<string, Promise<CryptoKey>>();   // 한 번의 함수 호출 안에서 unwrap 1회

  async function load(userId: string, create: boolean): Promise<CryptoKey> {
    const aad = te.encode("user_keys:" + userId);
    let wrapped = await store.get(userId);
    if (!wrapped) {
      if (!create) throw new Error("no data key for user");
      const dek = crypto.getRandomValues(new Uint8Array(32));
      wrapped = await store.putIfAbsent(userId, await seal(await master, dek, aad));
    }
    return await aesKey(await open(await master, wrapped, aad));
  }
  function dataKey(userId: string, create: boolean): Promise<CryptoKey> {
    let p = cache.get(userId);
    if (!p) {
      p = load(userId, create);
      cache.set(userId, p);
      p.catch(() => cache.delete(userId));
    }
    return p;
  }

  return {
    async encrypt(userId: string, plaintext: string): Promise<Uint8Array> {
      return await seal(await dataKey(userId, true), te.encode(plaintext), te.encode("items:" + userId));
    },
    async decrypt(userId: string, data: Uint8Array | string): Promise<string> {
      return td.decode(await open(await dataKey(userId, false), fromBytea(data), te.encode("items:" + userId)));
    },
  };
}

// 오류에는 PostgREST 코드만 담는다(메시지에 값이 섞이지 않게)
export function supabaseKeyStore(sb: SupabaseClient): KeyStore {
  return {
    async get(userId) {
      const { data, error } = await sb.rpc("get_wrapped_key", { p_user: userId });
      if (error) throw new Error("get_wrapped_key " + error.code);
      return data ? fromBytea(data as string) : null;
    },
    async putIfAbsent(userId, wrapped) {
      const { data, error } = await sb.rpc("put_wrapped_key", { p_user: userId, p_wrapped: toBytea(wrapped) });
      if (error) throw new Error("put_wrapped_key " + error.code);
      return fromBytea(data as string);
    },
  };
}

// 서버 쪽 클라이언트: 세션 저장·토큰 자동 갱신 타이머를 켜지 않는다
export const SERVER_AUTH = { auth: { persistSession: false, autoRefreshToken: false } };

let envelope: ReturnType<typeof createEnvelope> | null = null;
function defaultEnvelope() {
  envelope ??= createEnvelope(
    supabaseKeyStore(createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, SERVER_AUTH)),
    Deno.env.get("MASTER_KEY")!,
  );
  return envelope;
}
export const encrypt = (userId: string, plaintext: string) => defaultEnvelope().encrypt(userId, plaintext);
export const decrypt = (userId: string, data: Uint8Array | string) => defaultEnvelope().decrypt(userId, data);
