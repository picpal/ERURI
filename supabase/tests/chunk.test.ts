import { assert, assertEquals } from "jsr:@std/assert";
import { chunkText } from "../functions/_shared/chunk.ts";

Deno.test("chunkText: ≤ size per chunk, prefers paragraph/sentence boundaries, nothing lost, empty → []", () => {
  assertEquals(chunkText("   "), []);
  assertEquals(chunkText("짧은 합성 문장."), ["짧은 합성 문장."]);
  const para = "가".repeat(300) + ".\n\n" + "나".repeat(300) + ". " + "다".repeat(100);
  const cs = chunkText(para, 512);
  assert(cs.every((c) => c.length <= 512));
  assertEquals(cs[0], "가".repeat(300) + ".");
  assertEquals(cs.join("").replace(/\s/g, ""), para.replace(/\s/g, ""));
  const long = "라".repeat(1300);                                            // 경계가 없으면 잘라서라도 나눈다
  assertEquals(chunkText(long, 512).map((c) => c.length), [512, 512, 276]);
});

Deno.test("chunkText: a hard cut never splits a surrogate pair (lone surrogate breaks the JSON → DB call)", () => {
  const s = "마".repeat(511) + "😀" + "바".repeat(10);                       // 이모지가 512번째 경계에 걸친다
  const cs = chunkText(s, 512);
  assertEquals(cs.join(""), s);
  assert(cs.every((c) => !/[\uD800-\uDBFF]$/.test(c) && !/^[\uDC00-\uDFFF]/.test(c)));
});
