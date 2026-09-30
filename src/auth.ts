import { timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler, Next } from "hono";
import type { Config } from "./config.js";

export function createAuthMiddleware(config: Config): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    // No key configured + insecure mode: allow all (local only).
    if (!config.apiKey) {
      await next();
      return;
    }

    const header = c.req.header("authorization") ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(header);
    const token = match?.[1]?.trim() ?? "";

    if (!token || !safe.equal(token, config.apiKey)) {
      return c.json(
        { error: "Unauthorized", message: "Valid Bearer API key required" },
        401,
      );
    }

    await next();
  };
}

const safe = {
  equal(a: string, b: string): boolean {
    const bufA = Buffer.from(a, "utf8");
    const bufB = Buffer.from(b, "utf8");
    if (bufA.length !== bufB.length) {
      // Consume comparable work without leaking equality via early return alone.
      timingSafeEqual(bufA, bufA);
      return false;
    }
    return timingSafeEqual(bufA, bufB);
  },
};
