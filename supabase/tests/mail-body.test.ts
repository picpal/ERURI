import { assert, assertEquals } from "jsr:@std/assert";
import type { MessagePart } from "../functions/_shared/gmail.ts";
import { BODY_SCAN_MAX, clipText, decodePartData, extractBody, htmlToText } from "../functions/_shared/mail-body.ts";

// 합성 MIME 픽스처(스펙 §15 SUMMARY-server "본문 추출"). 바이트는 base64url 로
const b64u = (bytes: Uint8Array) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join("")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const utf8 = (s: string) => b64u(new TextEncoder().encode(s));
const hex = (h: string) => b64u(Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16))));
const leaf = (mimeType: string, data: string, charset = "utf-8", extra: Partial<MessagePart> = {}): MessagePart =>
  ({ mimeType, headers: [{ name: "Content-Type", value: `${mimeType}; charset="${charset}"` }], body: { data }, ...extra });
const multi = (mimeType: string, parts: MessagePart[]): MessagePart => ({ mimeType, body: {}, parts });

Deno.test("multipart/alternative: first text/plain wins over text/html", () => {
  const p = multi("multipart/alternative", [leaf("text/plain", utf8("합성 안내 본문")), leaf("text/html", utf8("<p>다른 본문</p>"))]);
  assertEquals(extractBody(p), { text: "합성 안내 본문", attachments: 0 });
});
Deno.test("html only → text: block tags become new lines, no href, entities decoded, blank lines collapsed", () => {
  const html = `<p>합성 안내</p><div>10/20 <b>15:00</b></div><a href="https://evil.example/x">링크</a>&amp;&nbsp;끝<br>다음<p></p><p></p><p>마지막</p>`;
  const r = extractBody(leaf("text/html", utf8(html)));
  assertEquals(r.text, "합성 안내\n10/20 15:00\n링크& 끝\n다음\n\n마지막");
  assert(!r.text!.includes("evil.example"));
});
Deno.test("style, script and head blocks are removed — an unclosed one is dropped to the end; <header> is not <head>", () => {
  assertEquals(htmlToText(`<head><title>t</title></head><style>.x{color:red}</style>본문<script>alert(1)</script> 계속`), "본문 계속");
  assertEquals(htmlToText(`앞<script>var a = "<p>";`), "앞");
  assertEquals(htmlToText(`<header>머리</header>본문`), "머리본문");
});
Deno.test("nested multipart/mixed: the body comes from the alternative part; a filename part is counted, not read (and not descended into)", () => {
  const fwd: MessagePart = { mimeType: "message/rfc822", filename: "fwd.eml", body: { attachmentId: "a2" }, parts: [leaf("text/plain", utf8("첨부 안 메일"))] };
  const p = multi("multipart/mixed", [multi("multipart/alternative", [leaf("text/plain", utf8("본문")), leaf("text/html", utf8("<p>본문</p>"))]),
    leaf("application/pdf", "", "utf-8", { filename: "합성.pdf", body: { attachmentId: "a1" } }), fwd]);
  assertEquals(extractBody(p), { text: "본문", attachments: 2 });
});
Deno.test("a text/plain part with a filename is an attachment; the html part becomes the body", () => {
  const p = multi("multipart/mixed", [leaf("text/plain", utf8("첨부 메모"), "utf-8", { filename: "memo.txt" }), leaf("text/html", utf8("<p>본문</p>"))]);
  assertEquals(extractBody(p), { text: "본문", attachments: 1 });
});
// 스펙 §7: 본문 파트가 data 없이 attachmentId 만 → attachments.get 없이 첨부로 센다(→ no_body)
Deno.test("a body part that only has an attachmentId is counted as an attachment and gives no text", () => {
  const p = multi("multipart/alternative", [{ mimeType: "text/plain", body: { attachmentId: "big" } }]);
  assertEquals(extractBody(p), { text: null, attachments: 1 });
  assertEquals(extractBody(undefined), { text: null, attachments: 0 });
  assertEquals(extractBody(multi("multipart/mixed", [leaf("image/png", "", "utf-8", { filename: "a.png", body: { attachmentId: "i" } })])), { text: null, attachments: 1 });
});
Deno.test("an empty plain part falls back to html", () => {
  assertEquals(extractBody(multi("multipart/alternative", [leaf("text/plain", utf8("  \n")), leaf("text/html", utf8("<p>본문</p>"))])).text, "본문");
});
// U2: Gmail 이 body.data 를 원래 charset 바이트로 준다고 보고 합성 픽스처로 디코드를 고정한다
Deno.test("charset: EUC-KR (ks_c_5601-1987 label) and ISO-2022-JP parts decode; unknown labels fall back to UTF-8", () => {
  assertEquals(extractBody(leaf("text/plain", hex("c7d5bcbac0bac7e020bec8b3bb"), "ks_c_5601-1987")).text, "합성은행 안내");
  assertEquals(extractBody(leaf("text/plain", hex("c7d5bcbac0bac7e020bec8b3bb"), "EUC-KR")).text, "합성은행 안내");
  assertEquals(extractBody(leaf("text/plain", hex("1b24423967402e255b2546256b1b2842201b24424d3d4c73334e47271b28422031302f3235"), "iso-2022-jp")).text,
    "合成ホテル 予約確認 10/25");
  assertEquals(decodePartData(utf8("합성"), "text/plain; charset=x-unknown"), "합성");
  assertEquals(decodePartData(utf8("합성"), null), "합성");
  assertEquals(decodePartData(utf8("합성"), `text/plain; charset="UTF-8"`), "합성");
});
Deno.test("HTML longer than 1,000,000 UTF-16 is cut first; text stays within BODY_SCAN_MAX", () => {
  const t = htmlToText("<p>" + "가".repeat(1_100_000) + "</p>");
  assert(t.length <= BODY_SCAN_MAX);
});
// D8: 닫히지 않은 '<' 가 많아도 선형(Edge CPU 2초)
Deno.test("pathological HTML (1M '<', 150k unclosed <style) converts in under 2 s", () => {
  for (const html of ["<".repeat(1_000_000), "<style".repeat(150_000), "<a ".repeat(300_000)]) {
    const t0 = performance.now();
    htmlToText(html);
    const ms = performance.now() - t0;
    console.log(JSON.stringify({ html_ms: Math.round(ms) }));
    assert(ms < 2000, `${ms}ms`);
  }
});
Deno.test("clipText: 12,000 and 4,000 cuts never leave a lone surrogate; reports truncation", () => {
  assertEquals(clipText("가".repeat(11_999) + "🎉", 12_000), { text: "가".repeat(11_999), truncated: true });
  assertEquals(clipText("가".repeat(100), 4_000), { text: "가".repeat(100), truncated: false });
});
