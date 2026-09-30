// phrase-status.ts 매칭 로직(순수). 1차: 문구 sha8 = trace text_sha8. 2차(sha 불일치 — Slack 이 본문을 변형한 경우, M1-②d 게이트 A d06):
// 발송 순서로 대체 매칭 — 앞 문구에 짝지어진 trace 뒤, 뒤 문구에 짝지어진 trace 앞의 구간에서 아직 안 짝지어진 첫 trace. 발송 시각 없이 trace 순서만 쓴다.
export type Trace = { at: string; fields: Record<string, unknown> };
export type Match = { trace: Trace | null; by: "sha" | "order" | null };

export function matchPhrases(shas: string[], traces: Trace[]): Match[] {
  const ts = [...traces].sort((a, b) => a.at.localeCompare(b.at));
  const used = new Set<number>();
  const idx: (number | null)[] = shas.map((h) => {
    const i = ts.findIndex((t, j) => !used.has(j) && t.fields.text_sha8 === h);
    if (i < 0) return null;
    used.add(i);
    return i;
  });
  const by: Match["by"][] = idx.map((i) => (i === null ? null : "sha"));
  for (let k = 0; k < shas.length; k++) {
    if (idx[k] !== null) continue;
    let lo = -1;
    for (let p = k - 1; p >= 0; p--) if (idx[p] !== null) { lo = idx[p]!; break; }
    let hi = ts.length;
    for (let n = k + 1; n < shas.length; n++) if (by[n] === "sha") { hi = idx[n]!; break; }
    for (let j = lo + 1; j < hi; j++) {
      if (used.has(j)) continue;
      used.add(j);
      idx[k] = j;
      by[k] = "order";
      break;
    }
  }
  return idx.map((i, k) => ({ trace: i === null ? null : ts[i], by: by[k] }));
}
