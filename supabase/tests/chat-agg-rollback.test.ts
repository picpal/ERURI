import { assert, assertEquals } from "jsr:@std/assert";
import { okAggregate as okAggregate0170 } from "./_old/chat-aggregate-0170.ts";

// 구 chat 조합(계획 K26 — Review Focus 6): 0.18.0 배포 뒤 worker·chat 을 되돌려도 metrics 행·0036 은 남는다.
// 0036 은 total·칸 count 를 메시지 수로 두므로 0.17.0 aggregate.ts 가 읽으면 metrics 가 없을 때와 같은 문장이어야 한다. 값은 합성 문구만
Deno.test("old chat (0.17.0 aggregate.ts) on a 0036 result with metrics → 0.17.0 message-count sentence, identical to the no-metrics result", () => {
  const C = { keywords: ["합성결제", "타임아웃"], sender: null, sources: [], from: "2026-10-22", to: "2026-10-22", bucket: "hour" as const, defaulted: false, clamped: false };
  // N2 롤백 조합 사례의 r1·r0 모양(키만 오늘 날짜로)
  const withM = { total: 3, body_total: 10, metric_items: 2, metric_unmatched: 0, buckets: [{ key: "14", count: 1, body: 6 }, { key: "15", count: 1, body: 3 }, { key: "16", count: 1, body: 1 }] };
  const noM = { total: 3, buckets: [{ key: "14", count: 1 }, { key: "15", count: 1 }, { key: "16", count: 1 }] };
  const s = (r: { total: number; buckets: { key: string; count: number }[] }) => okAggregate0170(C, r.buckets, r.total, [], "2026-10-22").sentence;   // 0.17.0 handler 호출 모양(F9)
  assertEquals(s(withM), s(noM));
  assertEquals(s(withM), "10/22 '합성결제·타임아웃' 메시지 3건 — 14시대·15시대·16시대가 각각 1건으로 가장 많았어요");
  assert(!s(withM).includes("6건"));
});
