import { DEVICE10, PUSH_TEMPLATE, renderPhrase } from "../eval/phrases.ts";
import { seoulToday } from "../functions/_shared/time.ts";

// 합성 문구 발송 공통(Slack·Twilio). 기본은 d01~d10, `push` 는 PoC-5 용 미래 날짜 문구.
// 출력은 id·보낸 시각·sha8·길이·결과 코드만 — 본문·URL·번호를 출력하지 않는다. sha8 은 기기 trace text_sha8 과 대조하는 용도다
export type SenderArgs = { only: string[] | null; gapSec: number; dryRun: boolean };
export type Send = (text: string) => Promise<{ ok: boolean; code: string }>;

export function sendable(today: string): { id: string; text: string }[] {
  return [...DEVICE10.map((p) => ({ id: p.id, text: p.text })), { id: "push", text: renderPhrase(PUSH_TEMPLATE, today) }];
}

export function parseSenderArgs(args: string[], defaultGapSec: number): SenderArgs {
  const at = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const gap = Number(at("--gap") ?? defaultGapSec);
  // `--only` 뒤 값이 없거나(`--only` 가 끝, 다음이 플래그) 비어 있으면 전체 발송으로 넘어가지 않고 멈춘다(실기기 측정 오염 방지)
  let only: string[] | null = null;
  if (args.includes("--only")) {
    const v = at("--only");
    only = v === undefined || v.startsWith("--") ? [] : v.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    if (only.length === 0) throw new Error("--only needs phrase ids (e.g. --only d02,d09 or --only push)");
  }
  return { only,
    gapSec: Number.isFinite(gap) && gap >= 0 ? gap : defaultGapSec, dryRun: args.includes("--dry-run") };
}

export async function sha8(s: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return Array.from(h.slice(0, 4), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function runSender(send: Send, a: SenderArgs, o: { sleep?: (ms: number) => Promise<void>; now?: () => Date; print?: (s: string) => void } = {}):
  Promise<number> {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = o.now ?? (() => new Date());
  const print = o.print ?? ((s: string) => console.log(s));
  const all = sendable(seoulToday(now()));
  for (const id of a.only ?? []) if (!all.some((p) => p.id === id)) throw new Error(`unknown phrase id ${id}`);
  const list = a.only === null ? all.filter((p) => p.id !== "push") : all.filter((p) => a.only!.includes(p.id));
  let failures = 0;
  for (const [i, p] of list.entries()) {
    if (i > 0 && a.gapSec > 0) await sleep(a.gapSec * 1000);
    const at = now().toISOString();
    const r = a.dryRun ? { ok: true, code: "dry" } : await send(p.text).catch(() => ({ ok: false, code: "network" }));
    if (!r.ok) failures++;
    print([p.id, at, `sha8=${await sha8(p.text)}`, `len=${p.text.length}`, r.code].join("\t"));
  }
  return failures;
}
