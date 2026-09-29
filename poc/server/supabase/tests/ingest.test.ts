import { assertEquals } from "jsr:@std/assert";
import { handleIngest, type IngestDeps, type NewItem, parseCapturedAt } from "../functions/ingest/handler.ts";

// 가짜 의존성: encrypt는 평문 바이트를 그대로 돌려줘 무엇이 암호화됐는지 검사한다
function deps(o: { user?: string | null; duplicate?: boolean } = {}) {
  const inserted: NewItem[] = [], looked: [string, string][] = [];
  const d: IngestDeps = {
    authUser: async (t) => (t === "good" ? (o.user === undefined ? "user-1" : o.user) : null),
    encrypt: async (_u, p) => new TextEncoder().encode(p),
    insertItem: async (item) => { inserted.push(item); return o.duplicate ? null : "item-1"; },
    findItem: async (user, key) => { looked.push([user, key]); return "item-existing"; },
  };
  return { d, inserted, looked };
}
const req = (body: unknown, token: string | null = "good") => new Request("http://x/ingest", {
  method: "POST", body: JSON.stringify(body),
  headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
});
const base = { id: "A1B2", source: "NOTIFICATION", appName: "KakaoTalk", sender: null, title: "합성쇼핑",
  text: "주문이 접수되었습니다", ocrText: null, capturedAt: 780000000, attempts: 0 };
const dec = (b: Uint8Array | null) => (b ? new TextDecoder().decode(b) : null);

Deno.test("401 without or with invalid token, nothing stored", async () => {
  const { d, inserted } = deps();
  assertEquals((await handleIngest(req(base, null), d)).status, 401);
  assertEquals((await handleIngest(req(base, "bad"), d)).status, 401);
  assertEquals(inserted.length, 0);
});

Deno.test("OTP text or OTP in OCR → 204, nothing stored", async () => {
  const { d, inserted } = deps();
  assertEquals((await handleIngest(req({ ...base, text: "[Web발신] 인증번호 483920 을 입력하세요" }), d)).status, 204);
  assertEquals((await handleIngest(req({ ...base, source: "SHARE", text: "사진", ocrText: "승인번호 5521 입력" }), d)).status, 204);
  assertEquals(inserted.length, 0);
});

Deno.test("promotion (광고) → 204", async () => {
  const { d, inserted } = deps();
  assertEquals((await handleIngest(req({ ...base, text: "(광고) 가을 세일 최대 50%" }), d)).status, 204);
  assertEquals(inserted.length, 0);
});

Deno.test("card/account masked before encrypt, title masked, idempotency key = source:id", async () => {
  const { d, inserted } = deps();
  const r = await handleIngest(req({ ...base, source: "MESSAGES", title: "결제 4532015112830366",
    text: "카드 4532-0151-1283-0366 승인 32,000원", ocrText: "국민은행 계좌 12345678901234 로 입금" }), d);
  assertEquals(r.status, 202);
  assertEquals(await r.json(), { item_id: "item-1", duplicate: false });
  const it = inserted[0];
  assertEquals(dec(it.contentEnc), "카드 ****-****-****-0366 승인 32,000원");
  assertEquals(dec(it.ocrTextEnc), "국민은행 계좌 **********1234 로 입금");
  assertEquals(it.title, "결제 ************0366");
  assertEquals(it.idempotencyKey, "MESSAGES:A1B2");
  assertEquals(it.user, "user-1");
});

Deno.test("same idempotency key again → 200 + existing item id (looked up by caller user and source:id)", async () => {
  const { d, looked } = deps({ duplicate: true });
  const r = await handleIngest(req(base), d);
  assertEquals(r.status, 200);
  assertEquals(await r.json(), { item_id: "item-existing", duplicate: true });
  assertEquals(looked, [["user-1", "NOTIFICATION:A1B2"]]);
});

Deno.test("first insert does not look up; retry of the same id keeps the same idempotency key", async () => {
  const first = deps();
  assertEquals((await handleIngest(req(base), first.d)).status, 202);
  assertEquals(first.looked.length, 0);
  const again = deps({ duplicate: true });
  await handleIngest(req(base), again.d);
  assertEquals(again.inserted[0].idempotencyKey, first.inserted[0].idempotencyKey);
});

Deno.test("deviceFilter (Swift CaptureItem key) is stored as device_filter; absent or unknown → null", async () => {
  const { d, inserted } = deps();
  await handleIngest(req({ ...base, id: "F1", deviceFilter: "rules" }), d);
  await handleIngest(req({ ...base, id: "F2", deviceFilter: "fm" }), d);
  await handleIngest(req({ ...base, id: "F3" }), d);
  await handleIngest(req({ ...base, id: "F4", deviceFilter: "whatever" }), d);
  assertEquals(inserted.map((i) => i.deviceFilter), ["rules", "fm", null, null]);
});

Deno.test("bad body → 400 (unknown source, GMAIL from device, missing text, bad date)", async () => {
  const { d } = deps();
  for (const b of [{ ...base, source: "X" }, { ...base, source: "GMAIL" }, { ...base, text: undefined }, { ...base, capturedAt: "nope" }]) {
    assertEquals((await handleIngest(req(b), d)).status, 400);
  }
});

Deno.test("capturedAt: Swift reference-date seconds and ISO strings", () => {
  assertEquals(parseCapturedAt(0), "2001-01-01T00:00:00.000Z");
  assertEquals(parseCapturedAt("2026-09-23T09:00:00+09:00"), "2026-09-23T00:00:00.000Z");
});
