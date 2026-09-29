// 청크(스펙 §7: 512자). 문단 → 문장 경계를 먼저 쓰고, 경계 없는 긴 조각은 자른다. 공백만 있는 조각은 버린다
export function chunkText(text: string, size = 512): string[] {
  const pieces = text.split(/(?<=\n\n)|(?<=[.!?。]\s)|(?<=다\.\s)/).map((p) => p.trim()).filter((p) => p.length > 0);
  const out: string[] = [];
  let cur = "";
  const push = () => { if (cur.trim()) out.push(cur.trim()); cur = ""; };
  for (let p of pieces) {
    while (p.length > size) {                           // 경계 없는 긴 조각. 서로게이트 쌍은 가르지 않는다(짝 잃은 서로게이트는 JSON·DB 오류)
      push();
      const cut = /[\uD800-\uDBFF]/.test(p[size - 1]) ? size - 1 : size;
      out.push(p.slice(0, cut));
      p = p.slice(cut);
    }
    if (cur.length + (cur ? 1 : 0) + p.length > size) push();
    cur = cur ? `${cur} ${p}` : p;
  }
  push();
  return out;
}
