import { assertEquals } from "jsr:@std/assert";
import { checkUrl, ipBlocked, oneClickPost, type Resolver, resolveWith } from "../functions/_shared/safe-post.ts";

Deno.test("ipBlocked table", () => {
  const blocked = ["0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.0.0.8",
    "192.0.2.1", "192.168.1.1", "198.18.0.1", "198.51.100.2", "203.0.113.9", "224.0.0.1", "255.255.255.255",
    "::", "::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::127.0.0.1", "64:ff9b::a00:1", "2002:c0a8:101::1", "fc00::1", "fd12:3456::1",
    "fe80::1", "ff02::1", "2001:db8::1", "fe80::1%en0", "not-an-ip", "1.2.3", "1:2:3:4:5:6:7:8:9",
    // 리뷰 N11: 2000::/3 밖·특수 대역은 열거하지 않아도 막힌다
    "64:ff9b:1::a00:1", "2001::1", "2001:0:4136:e378::1", "3fff::1", "100::1", "4000::1", "1234::1"];
  const open = ["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "2606:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8", "64:ff9b::808:808"];
  for (const ip of blocked) assertEquals([ip, ipBlocked(ip)], [ip, true]);
  for (const ip of open) assertEquals([ip, ipBlocked(ip)], [ip, false]);
});

Deno.test("checkUrl: https only, 443, no userinfo, no local names", () => {
  assertEquals(checkUrl("http://u.example.com/x"), "blocked_scheme");
  assertEquals(checkUrl("ftp://u.example.com/x"), "blocked_scheme");
  assertEquals(checkUrl("not a url"), "blocked_scheme");
  for (const u of ["https://u.example.com:8443/x", "https://a:b@u.example.com/x", "https://localhost/x", "https://box.local/x",
                   "https://svc.internal/x", "https://router.home.arpa/x", "https://intranet/x", "https://x.localhost/x",
                   // 끝의 점(FQDN 표기)도 같은 이름으로 본다
                   "https://localhost./x", "https://box.local./x", "https://intranet./x"]) {
    assertEquals([u, checkUrl(u)], [u, "blocked_host"]);
  }
  assertEquals((checkUrl("https://u.example.com:443/x?t=1") as URL).hostname, "u.example.com");
  assertEquals((checkUrl("https://2130706433/") as URL).hostname, "127.0.0.1");   // 정수 표기도 WHATWG 파서가 정규화 → IP 검사 대상
});

type Call = { url: string; init: RequestInit };
function fakeFetch(responses: (Response | Error)[]) {
  const calls: Call[] = [];
  const f = ((url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const r = responses.shift()!;
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
  }) as typeof fetch;
  return { f, calls };
}
const pub: Resolver = async () => ["93.184.216.34"];

Deno.test("POST shape: one-click body, form content type, manual redirect, no auth/cookie", async () => {
  const { f, calls } = fakeFetch([new Response(null, { status: 200 })]);
  assertEquals(await oneClickPost("https://u.example.com/one?t=abc", { fetch: f, resolve: pub }), { ok: true, code: "ok" });
  assertEquals(calls.length, 1);
  const i = calls[0].init;
  assertEquals([calls[0].url, i.method, i.body, i.redirect], ["https://u.example.com/one?t=abc", "POST", "List-Unsubscribe=One-Click", "manual"]);
  const h = new Headers(i.headers);
  assertEquals([h.get("content-type"), h.get("authorization"), h.get("cookie")], ["application/x-www-form-urlencoded", null, null]);
});

// 리뷰 M1: RFC 8058 §3.1 — 발신자 서버는 리다이렉트하지 않아야 한다. 3xx 는 접수 증거가 아니고, 따라가면 SSRF 표면이 넓어진다
Deno.test("2xx ok; every 3xx is one request and redirect_<n> (never followed); 4xx/5xx http_<n>", async () => {
  for (const [s, code] of [[200, "ok"], [202, "ok"], [204, "ok"], [301, "redirect_301"], [302, "redirect_302"], [303, "redirect_303"],
                           [307, "redirect_307"], [308, "redirect_308"], [404, "http_404"], [500, "http_500"]] as const) {
    const { f, calls } = fakeFetch([new Response(null, { status: s, headers: s >= 300 && s < 400 ? { location: "https://inside.example.com/x" } : {} })]);
    assertEquals(await oneClickPost("https://u.example.com/x", { fetch: f, resolve: pub }), { ok: code === "ok", code });
    assertEquals(calls.length, 1);
  }
});

// 리뷰 N8: Edge 에서 Deno.resolveDns 가 있어도 권한·미지원으로 던지면 DoH 로 넘어가야 한다
Deno.test("resolveWith: both Deno lookups reject → fallback; one answer is enough; no resolveDns → fallback", async () => {
  const doh: Resolver = async () => ["93.184.216.34"];
  const rej = () => Promise.reject(new Error("PermissionDenied"));
  assertEquals(await resolveWith(rej, doh, "u.example.com"), ["93.184.216.34"]);
  assertEquals(await resolveWith((_h, t) => (t === "A" ? Promise.resolve(["1.1.1.1"]) : rej()), doh, "u.example.com"), ["1.1.1.1"]);
  assertEquals(await resolveWith(async (_h, t) => (t === "A" ? ["1.1.1.1"] : ["2606:4700::1111"]), doh, "u.example.com"), ["1.1.1.1", "2606:4700::1111"]);
  assertEquals(await resolveWith(undefined, doh, "u.example.com"), ["93.184.216.34"]);
});

Deno.test("DNS: any private answer blocks, empty or failing → dns_error, IP literal skips DNS", async () => {
  const { f, calls } = fakeFetch([]);
  assertEquals(await oneClickPost("https://u.example.com/x", { fetch: f, resolve: async () => ["93.184.216.34", "127.0.0.1"] }), { ok: false, code: "blocked_private" });
  assertEquals(await oneClickPost("https://u.example.com/x", { fetch: f, resolve: async () => [] }), { ok: false, code: "dns_error" });
  assertEquals(await oneClickPost("https://u.example.com/x", { fetch: f, resolve: () => Promise.reject(new Error("x")) }), { ok: false, code: "dns_error" });
  let asked = false;
  assertEquals(await oneClickPost("https://10.0.0.1/x", { fetch: f, resolve: async () => { asked = true; return ["93.184.216.34"]; } }), { ok: false, code: "blocked_private" });
  assertEquals(await oneClickPost("https://[::1]/x", { fetch: f, resolve: pub }), { ok: false, code: "blocked_private" });
  assertEquals([asked, calls.length], [false, 0]);
});

Deno.test("timeout and network errors", async () => {
  const hang = ((_u: string | URL, init: RequestInit = {}) =>
    new Promise((_, rej) => init.signal!.addEventListener("abort", () => rej(init.signal!.reason)))) as typeof fetch;
  assertEquals(await oneClickPost("https://u.example.com/x", { fetch: hang, resolve: pub, timeoutMs: 50 }), { ok: false, code: "timeout" });
  const { f } = fakeFetch([new TypeError("connection refused")]);
  assertEquals(await oneClickPost("https://u.example.com/x", { fetch: f, resolve: pub }), { ok: false, code: "network" });
});
