import { assertEquals } from "jsr:@std/assert";
import type { GmailMessage } from "../functions/_shared/gmail.ts";
import { dkimCovers, hasListUnsub, isAdMail, listUnsubUris, parseFrom, unsubMeta } from "../functions/_shared/unsub.ts";

// 합성 헤더만(AGENTS.md §7). 도메인은 example.com/net
const msg = (h: Record<string, string | string[]>, labelIds = ["INBOX"]): GmailMessage => ({
  id: "m1", internalDate: "1790000000000", labelIds,
  payload: { headers: Object.entries(h).flatMap(([name, v]) => (Array.isArray(v) ? v : [v]).map((value) => ({ name, value }))) },
});
const FROM = '"합성쇼핑" <news@mail.example.com>';
const LU = "<mailto:unsub@mail.example.com?subject=unsub>, <https://u.example.com/one?t=abc>";
const LUP = "List-Unsubscribe=One-Click";
// Gmail AR 형식: dkim=pass header.i=@<d> header.s=<selector> header.b=<서명값 앞 8자>
const AR_PASS = "mx.google.com; dkim=pass header.i=@example.com header.s=s1 header.b=AbC+d/Ef; spf=pass smtp.mailfrom=bounce@mail.example.com";
const SIG = "v=1; a=rsa-sha256; d=example.com; s=s1; h=From:Subject:List-Unsubscribe:List-Unsubscribe-Post:Date; bh=x; b=AbC+d/Ef 9xYz\r\n Qw==";

Deno.test("parseFrom: display name + angle address, bare address, quoted, junk", () => {
  assertEquals(parseFrom(FROM), { address: "news@mail.example.com", name: "합성쇼핑" });
  assertEquals(parseFrom("News@Example.COM"), { address: "news@example.com", name: null });
  assertEquals(parseFrom("합성 상점 <a@example.net>"), { address: "a@example.net", name: "합성 상점" });
  assertEquals(parseFrom("x".repeat(80) + " <a@example.net>")!.name!.length, 60);
  assertEquals(parseFrom("no address here"), null);
  assertEquals(parseFrom(null), null);
});

Deno.test("listUnsubUris: angle-bracket list in order", () => {
  assertEquals(listUnsubUris(LU), ["mailto:unsub@mail.example.com?subject=unsub", "https://u.example.com/one?t=abc"]);
  assertEquals(listUnsubUris("https://no-brackets.example.com"), []);
  assertEquals(listUnsubUris(null), []);
});

Deno.test("one_click: https + Post header + Gmail dkim=pass aligned (parent domain) + signature covers both headers", () => {
  const m = msg({ From: FROM, "List-Unsubscribe": LU, "List-Unsubscribe-Post": LUP, "Authentication-Results": AR_PASS, "DKIM-Signature": SIG });
  assertEquals(unsubMeta(m), { address: "news@mail.example.com", name: "합성쇼핑", method: "one_click", url: "https://u.example.com/one?t=abc" });
  assertEquals(dkimCovers(m, "mail.example.com"), true);
});

Deno.test("dkim: unsigned / unaligned / uncovered / non-Gmail AR first → unverified, no url", () => {
  const base = { From: FROM, "List-Unsubscribe": LU, "List-Unsubscribe-Post": LUP };
  const cases: Record<string, string | string[]>[] = [
    { ...base },                                                                                   // 서명·AR 없음
    { ...base, "Authentication-Results": AR_PASS.replace("@example.com", "@evil.example.net"), "DKIM-Signature": SIG.replace("d=example.com", "d=evil.example.net") },
    { ...base, "Authentication-Results": AR_PASS, "DKIM-Signature": SIG.replace(":List-Unsubscribe-Post", "") },   // Post 헤더 미서명
    { ...base, "Authentication-Results": AR_PASS.replace("dkim=pass", "dkim=fail"), "DKIM-Signature": SIG },
    { ...base, "Authentication-Results": ["relay.example.net; dkim=pass header.i=@example.com"], "DKIM-Signature": SIG },  // Gmail AR 아님
  ];
  for (const h of cases) assertEquals(unsubMeta(msg(h))?.method, "unverified");
  for (const h of cases) assertEquals(unsubMeta(msg(h))?.url, null);
});

Deno.test("dkim: reverse alignment (signer is a subdomain of From) is not accepted", () => {
  const m = msg({ From: "a@example.com", "List-Unsubscribe": "<https://u.example.com/x>", "List-Unsubscribe-Post": LUP,
    "Authentication-Results": "mx.google.com; dkim=pass header.i=@mail.example.com header.s=s1 header.b=AbC+d/Ef", "DKIM-Signature": SIG.replace("d=example.com", "d=mail.example.com") });
  assertEquals(unsubMeta(m)?.method, "unverified");
});

// 리뷰 H1: 통과한 서명과 h= 를 검사하는 서명이 같아야 한다. Codex 재현 사례 — 정상 서명은 From·Subject 만, 같은 d= 의 무효 서명이 해지 헤더를 h= 에 적음
Deno.test("dkim: signature pinned by selector and b= prefix; duplicate headers/URIs, AR without header.b, Gmail AR not on top → unverified", () => {
  const base = { From: FROM, "List-Unsubscribe": LU, "List-Unsubscribe-Post": LUP };
  const AR_GOOD = "mx.google.com; dkim=pass header.i=@example.com header.s=good header.b=GOOD1234";
  const good = "v=1; d=example.com; s=good; h=From:Subject; b=GOOD1234rest";
  const forged = "v=1; d=example.com; s=forged; h=From:List-Unsubscribe:List-Unsubscribe-Post; b=INVALID";
  const sameSelector = "v=1; d=example.com; s=good; h=From:List-Unsubscribe:List-Unsubscribe-Post; b=BAD00000";   // selector 같아도 b= 가 다르면 다른 서명
  const cases: Record<string, string | string[]>[] = [
    { ...base, "Authentication-Results": AR_GOOD, "DKIM-Signature": [good, forged] },
    { ...base, "Authentication-Results": AR_GOOD, "DKIM-Signature": [good, sameSelector] },
    { ...base, "List-Unsubscribe": [LU, "<https://other.example.com/u>"], "Authentication-Results": AR_PASS, "DKIM-Signature": SIG },   // 해지 헤더 2개
    { ...base, "List-Unsubscribe-Post": [LUP, LUP], "Authentication-Results": AR_PASS, "DKIM-Signature": SIG },
    { ...base, "List-Unsubscribe": "<https://u.example.com/a>, <https://u.example.com/b>", "Authentication-Results": AR_PASS, "DKIM-Signature": SIG },   // https URI 2개
    { ...base, "Authentication-Results": "mx.google.com; dkim=pass header.i=@example.com header.s=s1", "DKIM-Signature": SIG },    // header.b 없음
    { ...base, "Authentication-Results": ["relay.example.net; spf=pass", AR_PASS], "DKIM-Signature": SIG },                         // 맨 위 AR 이 Gmail 것이 아님
    { ...base, "Authentication-Results": AR_PASS, "DKIM-Signature": [SIG, SIG] },                                                   // 같은 서명 둘 = 특정 불가
  ];
  for (const [i, h] of cases.entries()) assertEquals([i, unsubMeta(msg(h))?.method, unsubMeta(msg(h))?.url], [i, "unverified", null]);
  // 통과 서명이 둘 중 하나일 때도 그 하나가 덮으면 one_click
  const ok = msg({ ...base, "Authentication-Results": AR_PASS, "DKIM-Signature": [forged, SIG] });
  assertEquals(unsubMeta(ok)?.method, "one_click");
});

Deno.test("methods: link_only, mailto, none; URL over 2048 chars ignored", () => {
  assertEquals(unsubMeta(msg({ From: FROM, "List-Unsubscribe": "<https://u.example.com/page>" }))?.method, "link_only");
  assertEquals(unsubMeta(msg({ From: FROM, "List-Unsubscribe": "<mailto:u@example.com>", "List-Unsubscribe-Post": LUP }))?.method, "mailto");
  assertEquals(unsubMeta(msg({ From: FROM }))?.method, "none");
  const long = "<https://u.example.com/" + "a".repeat(2100) + ">";
  assertEquals(unsubMeta(msg({ From: FROM, "List-Unsubscribe": long, "List-Unsubscribe-Post": LUP, "Authentication-Results": AR_PASS, "DKIM-Signature": SIG }))?.method, "none");
  assertEquals(unsubMeta(msg({ From: FROM, "List-Unsubscribe": "<http://u.example.com/x>", "List-Unsubscribe-Post": LUP }))?.method, "none");   // http 는 링크로 치지 않는다
});

Deno.test("unsubMeta never throws on malformed headers", () => {
  const weird: Record<string, string | string[]>[] = [
    {}, { From: "" }, { From: "<>" }, { From: FROM, "List-Unsubscribe": "<<<>>>" },
    { From: FROM, "List-Unsubscribe": LU, "List-Unsubscribe-Post": LUP, "Authentication-Results": ";;;=", "DKIM-Signature": "=;=;h" },
  ];
  for (const h of weird) unsubMeta(msg(h));
  assertEquals(unsubMeta({ payload: undefined }), null);
});

Deno.test("hasListUnsub / isAdMail: promotion label, (광고) subject or sender; not plain mail", () => {
  assertEquals(hasListUnsub(msg({ From: FROM, "List-Unsubscribe": LU })), true);
  assertEquals(hasListUnsub(msg({ From: FROM })), false);
  assertEquals(isAdMail(msg({ From: FROM, Subject: "가을 세일" }, ["INBOX", "CATEGORY_PROMOTIONS"])), true);
  assertEquals(isAdMail(msg({ From: FROM, Subject: "(광고) 합성 할인" })), true);
  assertEquals(isAdMail(msg({ From: "[광고] 합성몰 <a@example.com>", Subject: "안내" })), true);
  assertEquals(isAdMail(msg({ From: FROM, Subject: "합성 주문 확인" })), false);
  assertEquals(isAdMail(msg({ From: FROM, Subject: "광고 문의 답변" })), false);   // 맨 앞 (광고) 표기가 아니다
});
