import { assertEquals, assertRejects } from "jsr:@std/assert";
import { withHeartbeat } from "../functions/worker/heartbeat.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.test("beats periodically while the job runs and stops after it finishes", async () => {
  let beats = 0;
  const out = await withHeartbeat(async () => { beats++; }, async () => { await sleep(110); return "done"; }, 25);
  assertEquals(out, "done");
  const atEnd = beats;
  assertEquals(atEnd >= 3 && atEnd <= 4, true);
  await sleep(80);
  assertEquals(beats, atEnd);
});

Deno.test("stops beating when the job throws; beat errors do not fail the job", async () => {
  let beats = 0;
  await assertRejects(() => withHeartbeat(async () => { beats++; throw new Error("net"); }, async () => { await sleep(60); throw new Error("boom"); }, 25), Error, "boom");
  const atEnd = beats;
  await sleep(60);
  assertEquals(beats, atEnd);
});

Deno.test("short job never beats", async () => {
  let beats = 0;
  assertEquals(await withHeartbeat(async () => { beats++; }, async () => "ok", 25), "ok");
  await sleep(40);
  assertEquals(beats, 0);
});
