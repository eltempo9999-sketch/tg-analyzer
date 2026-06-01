import type { MiddlewareHandler } from "hono";

const SECRET = process.env.TG_ANALYZER_SECRET ?? "";

export const authMiddleware: MiddlewareHandler = async (c, next) => {
  if (!SECRET) {
    console.warn("[tg-analyzer] TG_ANALYZER_SECRET not set — rejecting all requests");
    return c.json({ ok: false, error: "Service not configured" }, 503);
  }
  const auth = c.req.header("Authorization") ?? "";
  if (auth !== `Bearer ${SECRET}`) {
    return c.json({ ok: false, error: "Unauthorized" }, 401);
  }
  await next();
};
