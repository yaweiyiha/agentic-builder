import type { AppContext } from "../../../types/koa";

export async function getHealth(ctx: AppContext): Promise<void> {
  ctx.body = { status: "ok" };
}
