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

// 리뷰 I1: From 은 발신자가 정한다 — 정규식이 겹치는 공백에서 역추적하지 않아야 한다(gmail-fetch CPU 한도)
Deno.test("parseFrom: long or adversarial From finishes fast; over 1000 chars → null", () => {
  const inputs = [" ".repeat(10000) + "x", " ".repeat(10000), "a" + " ".repeat(990) + "x", '"'.repeat(990) + "x <a@example.net>",
    "a@" + ".".repeat(990) + "@", "x".repeat(500) + " ".repeat(490) + "<a@example.net"];
  for (const v of inputs) {
    const t = performance.now();
    parseFrom(v);
    assertEquals([v.length, performance.now() - t < 50], [v.length, true]);
  }
  assertEquals(parseFrom("x".repeat(1000) + " <a@example.net>"), null);
  assertEquals(parseFrom("  " + FROM + "  "), { address: "news@mail.example.com", name: "합성쇼핑" });
});

// 리뷰 I2: AR 안의 주석·따옴표 문자열(SPF 주석, smtp.mailfrom 의 따옴표 local-part)은 공격자가 정할 수 있다
Deno.test("dkim: dkim=pass injected via AR comments or quoted strings → unverified; header.b must be base64", () => {
  const base = { From: FROM, "List-Unsubscribe": LU, "List-Unsubscribe-Post": LUP };
  const inj = "x; dkim=pass header.i=@example.com header.s=evil header.b=EVIL1234 ";
  const forged = "v=1; d=example.com; s=evil; h=From:List-Unsubscribe:List-Unsubscribe-Post; b=EVIL1234rest";
  const real = "mx.google.com; dkim=fail header.i=@example.com header.s=s1 header.b=AbC+d/Ef; spf=pass";
  const ars = [
    `${real} (google.com: domain of "${inj}"@evil.example.net designates 192.0.2.1 as permitted sender) smtp.mailfrom="${inj}"@evil.example.net`,
    `${real} (google.com: domain of ${inj}@evil.example.net designates 192.0.2.1 as permitted sender) smtp.mailfrom=a@evil.example.net`,
    `${real} smtp.mailfrom="${inj}"@evil.example.net`,
    `${real} (outer (nested) ${inj}) smtp.mailfrom=a@evil.example.net`,                       // 중첩 주석
    `${real} (a \\) ${inj}) smtp.mailfrom=a@evil.example.net`,                                 // 주석 안 이스케이프된 )
  ];
  for (const [i, ar] of ars.entries()) {
    const m = msg({ ...base, "Authentication-Results": ar, "DKIM-Signature": [SIG, forged] });
    assertEquals([i, unsubMeta(m)?.method, unsubMeta(m)?.url], [i, "unverified", null]);
  }
  // 주석이 결과 안에 있어도 진짜 dkim=pass 는 그대로 인정
  const ok = msg({ ...base, "Authentication-Results": "mx.google.com; dkim=pass (good signature) header.i=@example.com header.s=s1 header.b=AbC+d/Ef; spf=pass (google.com: ok) smtp.mailfrom=b@example.com", "DKIM-Signature": SIG });
  assertEquals(unsubMeta(ok)?.method, "one_click");
  // header.b 가 base64 문자가 아니면 특정하지 않는다
  const badB = msg({ ...base, "Authentication-Results": "mx.google.com; dkim=pass header.i=@example.com header.s=s1 header.b=AbC+d/E*", "DKIM-Signature": SIG.replace("b=AbC+d/Ef", "b=AbC+d/E*") });
  assertEquals(unsubMeta(badB)?.method, "unverified");
});

// 리뷰 Minor 3: header.d 가 없고 header.i 가 서명 d= 의 하위 도메인이면 그 서명으로 특정, 정렬은 서명의 d= 로
Deno.test("dkim: header.i in a subdomain of the signing domain pins the signature", () => {
  const sig = SIG.replace("d=example.com;", "d=example.com; i=news@mail.example.com;");
  const ar = "mx.google.com; dkim=pass header.i=news@mail.example.com header.s=s1 header.b=AbC+d/Ef";
  const m = msg({ From: FROM, "List-Unsubscribe": LU, "List-Unsubscribe-Post": LUP, "Authentication-Results": ar, "DKIM-Signature": sig });
  assertEquals(unsubMeta(m)?.method, "one_click");
  // header.d 가 있으면 그것과 정확히 같아야 한다
  const exact = msg({ From: FROM, "List-Unsubscribe": LU, "List-Unsubscribe-Post": LUP, "Authentication-Results": ar.replace("header.i=", "header.d=mail.example.com header.i="), "DKIM-Signature": sig });
  assertEquals(unsubMeta(exact)?.method, "unverified");
});

// 리뷰 Minor 4: RFC 2369 — 꺾쇠 안 공백(접힌 줄)은 무시한다
Deno.test("listUnsubUris: whitespace inside angle brackets is removed", () => {
  assertEquals(listUnsubUris("<https://u.example.com/a\r\n b?t=1 2>, <mailto:u@example.com>"), ["https://u.example.com/ab?t=12", "mailto:u@example.com"]);
});

// 재리뷰 I2(fix2): 주석 안 따옴표 local-part 의 ')' 로 SPF 주석을 일찍 닫는 주입 — dkim 앞구간만 읽으므로 막힌다
Deno.test("dkim: ')' inside a quoted local-part in the SPF comment cannot inject dkim=pass", () => {
  const base = { From: FROM, "List-Unsubscribe": LU, "List-Unsubscribe-Post": LUP };
  const lp = "a); dkim=pass header.i=@example.com header.s=evil header.b=EVIL1234 ; x";
  const forged = "v=1; d=example.com; s=evil; h=From:List-Unsubscribe:List-Unsubscribe-Post; b=EVIL1234rest";
  const real = "mx.google.com; dkim=fail header.i=@example.com header.s=s1 header.b=AbC+d/Ef; spf=pass";
  const ars = [
    `${real} (google.com: domain of "${lp}"@evil.example.net designates 192.0.2.1 as permitted sender) smtp.mailfrom="${lp}"@evil.example.net`,
    `${real} (google.com: domain of "${lp}"@evil.example.net designates 192.0.2.1 as permitted sender) smtp.mailfrom=a@evil.example.net`,
  ];
  for (const [i, ar] of ars.entries()) {
    const m = msg({ ...base, "Authentication-Results": ar, "DKIM-Signature": [SIG, forged] });
    assertEquals([i, unsubMeta(m)?.method, unsubMeta(m)?.url], [i, "unverified", null]);
  }
});

// Codex 재확인 [MED] 1: RFC 8601 값은 quoted-string 일 수 있다 — header.b 만(fix3: 따옴표는 b 값에만, 나머지는 AR 전체를 버린다)
Deno.test("dkim: quoted header.b is unquoted (RFC 8601 §2.2); quoted header.i / header.s → unverified (fix3)", () => {
  const base = { From: FROM, "List-Unsubscribe": LU, "List-Unsubscribe-Post": LUP, "DKIM-Signature": SIG };
  for (const ar of [
    'mx.google.com; dkim=pass header.i=@example.com header.s=s1 header.b="AbC+d/Ef"',
    'mx.google.com; dkim=pass header.i=@example.com header.s=s1 header.b="AbC+d/Ef"; spf=pass',
  ]) assertEquals([ar, unsubMeta(msg({ ...base, "Authentication-Results": ar }))?.method], [ar, "one_click"]);
  for (const ar of [
    'mx.google.com; dkim=pass header.i="@example.com" header.s="s1" header.b="AbC+d/Ef"; spf=pass',
    'mx.google.com; dkim=pass header.i="news.team"@example.com header.s=s1 header.b=AbC+d/Ef',
  ]) assertEquals([ar, unsubMeta(msg({ ...base, "Authentication-Results": ar }))?.method], [ar, "unverified"]);
});

// 정상 Gmail AR: 접힌 줄, dkim 2개(ESP + 정렬 서명), arc·spf·dmarc 주석, 따옴표 smtp.mailfrom
Deno.test("dkim: realistic Gmail AR (two dkim, arc/spf/dmarc comments, quoted mailfrom) → one_click", () => {
  const esp = "v=1; d=esp.example.net; s=e1; h=From:Subject; b=XyZ12345more";
  const ar = "mx.google.com;\r\n       dkim=pass header.i=@esp.example.net header.s=e1 header.b=XyZ12345;\r\n" +
    "       dkim=pass (2048-bit key) header.i=@example.com header.s=s1 header.b=AbC+d/Ef;\r\n" +
    "       arc=pass (i=1 spf=pass spfdomain=example.com dkim=pass dkdomain=example.com dmarc=pass fromdomain=example.com);\r\n" +
    '       spf=pass (google.com: domain of "b.o"bounce@mail.example.com designates 192.0.2.1 as permitted sender) smtp.mailfrom="b.o"bounce@mail.example.com;\r\n' +
    "       dmarc=pass (p=NONE sp=NONE dis=NONE) header.from=example.com";
  const m = msg({ From: FROM, "List-Unsubscribe": LU, "List-Unsubscribe-Post": LUP, "Authentication-Results": ar, "DKIM-Signature": [esp, SIG] });
  assertEquals(unsubMeta(m)?.method, "one_click");
});

// dkim 결과는 authserv-id 바로 뒤 앞구간만 — 첫 비-dkim 메서드 뒤의 dkim= 은 읽지 않는다
Deno.test("dkim: dkim=pass only after spf/arc/dmarc → unverified", () => {
  const base = { From: FROM, "List-Unsubscribe": LU, "List-Unsubscribe-Post": LUP, "DKIM-Signature": SIG };
  const pass = "dkim=pass header.i=@example.com header.s=s1 header.b=AbC+d/Ef";
  for (const ar of [
    `mx.google.com; spf=pass smtp.mailfrom=b@example.com; ${pass}`,
    `mx.google.com; arc=pass; ${pass}`,
    `mx.google.com; dkim=fail header.i=@example.com header.s=s0 header.b=Zz; dmarc=pass header.from=example.com; ${pass}`,
    `mx.google.com; ${pass} (unclosed`,                                    // 닫히지 않은 주석 → 실패 쪽
    `mx.google.com; ${pass} reason="unclosed`,                             // 닫히지 않은 따옴표 → 실패 쪽
  ]) assertEquals([ar, unsubMeta(msg({ ...base, "Authentication-Results": ar }))?.method], [ar, "unverified"]);
});

// 재리뷰 Minor: 표시 이름에 '<' 가 있어도 마지막 '<…>' 가 주소
Deno.test("parseFrom: '<' inside the display name; last <…> is the address", () => {
  assertEquals(parseFrom('"a<b" <x@example.com>'), { address: "x@example.com", name: "a<b" });
  assertEquals(parseFrom('"합성 <공지>" <News@Example.com>'), { address: "news@example.com", name: "합성 <공지>" });
  assertEquals(parseFrom("a <b <x@example.com"), null);
  assertEquals(parseFrom("<a b@example.com>"), null);
  const t = performance.now();
  parseFrom("<".repeat(990) + "a@example.net>");
  parseFrom("a<".repeat(495) + ">");
  assertEquals(performance.now() - t < 50, true);
});

// AR 렉서는 한 번만 훑는다 — 긴·병적인 AR 도 빨리 끝난다
Deno.test("dkim: long or adversarial AR finishes fast", () => {
  const base = { From: FROM, "List-Unsubscribe": LU, "List-Unsubscribe-Post": LUP, "DKIM-Signature": SIG };
  const pass = "dkim=pass header.i=@example.com header.s=s1 header.b=AbC+d/Ef";
  for (const ar of [`mx.google.com; ${pass} ` + "(".repeat(50000), `mx.google.com; ${pass} reason="` + "\\a".repeat(50000),
    `mx.google.com; ${"dkim=fail header.s=x; ".repeat(5000)}${pass}`, `mx.google.com; ${pass} ` + "x=y ".repeat(20000)]) {
    const t = performance.now();
    unsubMeta(msg({ ...base, "Authentication-Results": ar }));
    assertEquals([ar.length, performance.now() - t < 50], [ar.length, true]);
  }
});

// 재리뷰 2 I2(fix3): 공격자 자기 서명의 i= 에 '(' — Gmail 이 header.i 에 그대로 찍으면 RFC 8601 렉서가 주석으로 읽어,
// 뒤따르는 ;·spf= 를 삼키고 발신자 칸(봉투 발신자 local-part)의 ')' 에서 닫혀 가짜 dkim=pass 가 dkim 구간에 들어왔다
Deno.test("dkim: '(' in the sender's own header.i cannot open a comment across resinfos (fix3)", () => {
  const base = { From: FROM, "List-Unsubscribe": LU, "List-Unsubscribe-Post": LUP };
  const own = "v=1; d=evil.example.net; i=a(@evil.example.net; s=e1; h=From; b=OwnSig12rest";
  const forged = "v=1; d=example.com; s=evil; h=From:List-Unsubscribe:List-Unsubscribe-Post; b=EVIL1234rest";
  const inj = "dkim=pass header.i=@example.com header.s=evil header.b=EVIL1234 ;";
  const head = "mx.google.com; dkim=pass header.i=a(@evil.example.net header.s=e1 header.b=OwnSig12; " +
    "dkim=fail header.i=@example.com header.s=evil header.b=EVIL1234; spf=pass";
  const ars = [
    `${head} (google.com: domain of "x)); ${inj} x"@evil.example.net designates 192.0.2.1 as permitted sender) smtp.mailfrom="x)); ${inj} x"@evil.example.net`,   // SPF 주석 + '))'
    `${head} smtp.mailfrom="x); ${inj} x"@evil.example.net`,                                                                                             // SPF 주석 없이 ')' 하나
  ];
  for (const [i, ar] of ars.entries()) {
    const m = msg({ ...base, "Authentication-Results": ar, "DKIM-Signature": [own, forged] });
    assertEquals([i, unsubMeta(m)?.method, unsubMeta(m)?.url], [i, "unverified", null]);
  }
});

// fix3: dkim 구간은 엄격 형식만 — dkim=<결과> [결과 바로 뒤 주석 1개] header.{i,d,s,b,a}=<엄격 토큰>, 공백으로 구분. 어긋나면 AR 전체를 버린다
Deno.test("dkim: strict dkim span — any deviation discards the whole AR (fix3)", () => {
  const base = { From: FROM, "List-Unsubscribe": LU, "List-Unsubscribe-Post": LUP, "DKIM-Signature": SIG };
  const hi = "header.i=@example.com", sb = "header.s=s1 header.b=AbC+d/Ef";
  const cases = [
    `dkim=pass (2048-bit key; x) ${hi} ${sb}`,               // 주석 안 ';'
    `dkim=pass (a"b) ${hi} ${sb}`,                             // 주석 안 '"'
    `dkim=pass (a\\b) ${hi} ${sb}`,                            // 주석 안 '\'
    `dkim=pass (a (b) c) ${hi} ${sb}`,                         // 중첩 주석
    `dkim=pass (a) (b) ${hi} ${sb}`,                           // 주석 2개
    `dkim=pass (${"x".repeat(65)}) ${hi} ${sb}`,               // 64자 넘는 주석
    `dkim=pass ${hi} (x) ${sb}`,                               // 결과 바로 뒤가 아닌 주석
    `dkim=pass(x) ${hi} ${sb}`,                                // 공백 없이 붙은 주석
    `dkim=pass ${hi} ${sb} reason="x"`,                        // 화이트리스트 밖 속성
    `dkim=pass ${hi} ${sb} header.from=example.com`,
    `dkim=pass ${hi} ${hi} ${sb}`,                             // 같은 속성 두 번
    `dkim=pass ${hi} header.s="s1" header.b=AbC+d/Ef`,         // 따옴표는 b 값에만
    `dkim=pass header.i=a(b@example.com ${sb}`,                // local-part 는 [A-Za-z0-9._%+-] 만
    `dkim=pass header.i=a=b@example.com ${sb}`,
    `dkim=pass header.i=a\\b@example.com ${sb}`,
    `dkim=pass header.i=@exa(mple.com ${sb}`,                  // 도메인은 라벨만
    `dkim=pass ${hi} header.s=s1(x) header.b=AbC+d/Ef`,
    `dkim=pass ${hi} header.s=s1 header.b="AbC d/Ef"`,         // 따옴표 안도 base64 만
    `dkim=pass ${hi} header.s=s1 header.b=AbC+d/Ef header.a=rsa(sha256)`,
    `dkim =pass ${hi} ${sb}`,                                  // dkim= 형식 밖
    `dkim=pa(ss ${hi} ${sb}`,
    `dkim=pass ${hi} ${sb}; dkim=pass header.i=a(@evil.example.net header.s=e1 header.b=OwnSig12`,   // 앞 결과가 정상이어도 하나라도 어긋나면 AR 전체
  ];
  for (const c of cases) {
    const ar = `mx.google.com; ${c}; spf=pass smtp.mailfrom=b@example.com`;
    assertEquals([c, unsubMeta(msg({ ...base, "Authentication-Results": ar }))?.method], [c, "unverified"]);
  }
});

// fix3: 정상 Gmail AR 형식은 엄격 문법에서도 one_click — 접힌 줄, dkim 2개, (2048-bit key) 주석, arc·spf·dmarc 뒤따름, 따옴표 header.b
Deno.test("dkim: normal Gmail AR formats stay one_click under the strict grammar (fix3)", () => {
  const esp = "v=1; d=esp.example.net; s=e1; h=From:Subject; b=XyZ12345more";
  const tail = "       arc=pass (i=1 spf=pass spfdomain=example.com dkim=pass dkdomain=example.com dmarc=pass fromdomain=example.com);\r\n" +
    '       spf=pass (google.com: domain of "b.o"bounce@mail.example.com designates 192.0.2.1 as permitted sender) smtp.mailfrom="b.o"bounce@mail.example.com;\r\n' +
    "       dmarc=pass (p=NONE sp=NONE dis=NONE) header.from=example.com";
  const ars = [
    "mx.google.com;\r\n       dkim=pass header.i=@esp.example.net header.s=e1 header.b=XyZ12345;\r\n" +
      '       dkim=pass (2048-bit key) header.i=@example.com header.s=s1 header.b="AbC+d/Ef";\r\n' + tail,
    "mx.google.com;\r\n\tdkim=neutral (body hash did not verify) header.i=@esp.example.net header.s=e1 header.b=XyZ12345;\r\n" +
      "\tdkim=pass header.i=news.team+x@mail.example.com header.d=example.com header.s=s1 header.a=rsa-sha256 header.b=AbC+d/Ef;\r\n" + tail,
    "MX.GOOGLE.COM; DKIM=PASS header.i=@Example.COM header.s=S1 header.b=AbC+d/Ef",
  ];
  for (const ar of ars) {
    const m = msg({ From: FROM, "List-Unsubscribe": LU, "List-Unsubscribe-Post": LUP, "Authentication-Results": ar, "DKIM-Signature": [esp, SIG] });
    assertEquals([ar, unsubMeta(m)?.method], [ar, "one_click"]);
  }
});

// fix3: 엄격 문법도 한 번만 훑는다 — 1만 자 병적 AR 50ms, throw 없음(속성 이름 constructor·__proto__ 포함)
Deno.test("dkim: strict grammar on 10k-char adversarial AR finishes fast and never throws (fix3)", () => {
  const base = { From: FROM, "List-Unsubscribe": LU, "List-Unsubscribe-Post": LUP, "DKIM-Signature": SIG };
  const p = "dkim=pass header.i=@example.com header.s=s1 header.b=AbC+d/Ef";
  const ars = [
    `mx.google.com; dkim=pass (${"a".repeat(10000)}) header.i=@example.com`,
    `mx.google.com; dkim=pass header.i=${"a.".repeat(5000)}@example.com header.s=s1 header.b=AbC+d/Ef`,
    `mx.google.com; dkim=pass header.i=@${"a-".repeat(5000)}! header.s=s1`,
    `mx.google.com; dkim=pass header.d=${"a.".repeat(5000)}.! header.s=s1`,
    `mx.google.com; dkim=pass header.s=${"a".repeat(10000)}( header.b=x`,
    `mx.google.com; dkim=pass header.b="${"A".repeat(10000)}`,
    `mx.google.com; ${"dkim=pass (x) ".repeat(700)}`,
    `mx.google.com; ${p}; ${"dkim".repeat(2500)}=pass`,
    `mx.google.com; ${"dkim=fail header.s=x; ".repeat(500)}${p}`,
    `mx.google.com;${" ".repeat(10000)}${p}`,
    `mx.google.com; dkim=${"a".repeat(10000)}`,
    `mx.google.com; dkim=pass ${"(".repeat(10000)}`,
    `mx.google.com; dkim=pass constructor=x __proto__=y toString=z`,
    `mx.google.com; dkim=pass ${"header.i=@example.com ".repeat(500)}`,
  ];
  for (const ar of ars) {
    const t = performance.now();
    unsubMeta(msg({ ...base, "Authentication-Results": ar }));
    dkimCovers(msg({ ...base, "Authentication-Results": ar }), "example.com");
    assertEquals([ar.length, performance.now() - t < 50], [ar.length, true]);
  }
});

// Ruling U1 hardening(재리뷰3 잔여 위험, QP 해제 가정): Gmail 이 운반 서명 i= 의 =3B=20 을 풀어 header.i 에 찍으면 문법에 맞는 dkim=pass 를 통째로 넣을 수 있다.
// 방어 — 특정된 서명을 가리키는 dkim 결과가 구간 안에 정확히 1개, dkim 결과 수 ≤ DKIM-Signature 수
Deno.test("dkim: QP-decoded injection (carrier + forged signature) → unverified (U1 hardening)", () => {
  const base = { From: FROM, "List-Unsubscribe": LU, "List-Unsubscribe-Post": LUP };
  const carrier = "v=1; d=evil.example.net; i=x@evil.example.net=3B=20dkim=3Dpass=20header.i=3D@example.com=20header.s=3Devil=20header.b=3DEVIL1234=3B=20dkim=3Dneutral=20header.i=3Dy@evil.example.net; s=e1; h=From; b=OwnSig12rest";
  const forged = "v=1; d=example.com; s=evil; h=From:List-Unsubscribe:List-Unsubscribe-Post; b=EVIL1234rest";
  // rr3 7번: 운반 서명 결과에 주입 pass(→ 위조 서명)가 끼고, 위조 서명에 대한 Gmail 의 진짜 fail 이 같은 서명을 가리킨다
  const rr3 = "mx.google.com; dkim=pass header.i=x@evil.example.net; dkim=pass header.i=@example.com header.s=evil header.b=EVIL1234; " +
    "dkim=neutral header.i=y@evil.example.net header.s=e1 header.b=OwnSig12; dkim=fail header.i=@example.com header.s=evil header.b=EVIL1234; spf=pass";
  // 결과 수 ≤ 서명 수는 지키지만(서명 3개) 위조 서명을 가리키는 결과가 2개
  const dup = "mx.google.com; dkim=pass header.i=@example.com header.s=evil header.b=EVIL1234; dkim=fail header.i=@example.com header.s=evil header.b=EVIL1234; dkim=pass header.i=@example.com header.s=s1 header.b=AbC+d/Ef";
  // 가리키는 결과는 1개씩이지만 결과(3) > 서명(2) — s·b 없는 결과도 센다
  const over = "mx.google.com; dkim=neutral header.i=x@evil.example.net; dkim=pass header.i=@example.com header.s=evil header.b=EVIL1234; dkim=neutral header.i=y@evil.example.net header.s=e1 header.b=OwnSig12";
  const cases: [string, string[]][] = [[rr3, [carrier, forged]], [dup, [carrier, forged, SIG.replace("h=From:Subject:List-Unsubscribe:List-Unsubscribe-Post:Date", "h=From")]], [over, [carrier, forged]]];
  for (const [i, [ar, sigs]] of cases.entries()) {
    const m = msg({ ...base, "Authentication-Results": ar, "DKIM-Signature": sigs });
    assertEquals([i, unsubMeta(m)?.method, unsubMeta(m)?.url, dkimCovers(m, "mail.example.com")], [i, "unverified", null, false]);
  }
  // 대조: 같은 서명들에 Gmail 이 서명마다 결과 1개씩 찍었고 위조가 pass 라면(가리키는 결과 1개) 여전히 one_click — 방어가 겨누는 것은 중복·초과뿐
  const clean = "mx.google.com; dkim=neutral header.i=x@evil.example.net header.s=e1 header.b=OwnSig12; dkim=pass header.i=@example.com header.s=evil header.b=EVIL1234";
  assertEquals(unsubMeta(msg({ ...base, "Authentication-Results": clean, "DKIM-Signature": [carrier, forged] }))?.method, "one_click");
});

Deno.test("dkim: normal Gmail AR (2 dkim results, 2 signatures) stays one_click; fewer results than signatures too (U1 hardening)", () => {
  const esp = "v=1; d=esp.example.net; s=e1; h=From:Subject; b=XyZ12345more";
  const two = "mx.google.com;\r\n       dkim=pass header.i=@esp.example.net header.s=e1 header.b=XyZ12345;\r\n" +
    "       dkim=pass (2048-bit key) header.i=@example.com header.s=s1 header.b=AbC+d/Ef;\r\n       spf=pass smtp.mailfrom=b@example.com";
  for (const [ar, sigs] of [[two, [esp, SIG]], [AR_PASS, [esp, SIG]]] as [string, string[]][]) {
    assertEquals(unsubMeta(msg({ From: FROM, "List-Unsubscribe": LU, "List-Unsubscribe-Post": LUP, "Authentication-Results": ar, "DKIM-Signature": sigs }))?.method, "one_click");
  }
});
