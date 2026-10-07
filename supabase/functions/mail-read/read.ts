import type { Ctx, MailReadDeps } from "./common.ts";
import { err } from "./common.ts";
// S4 에서 읽기로 교체한다(계획 S4). 그 전 배포는 없다
export async function read(_ctx: Ctx, _body: Record<string, unknown>, _d: MailReadDeps): Promise<Response> {
  return err(501, "not_implemented");
}
