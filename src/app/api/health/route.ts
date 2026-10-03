import { getRepository } from "@/lib/repository";
import { ENGINE_VERSION } from "@/lib/engine";
import { ok, fail } from "@/lib/errors";

export const runtime = "nodejs";

/**
 * Health check.
 *
 * This deliberately does more than return `{ ok: true }`. It runs a real query
 * against whichever adapter is active and reports which one it is, so a
 * deployment that silently lost its database connection is visible here rather
 * than surfacing as empty boards much later.
 */
export async function GET() {
  try {
    const repo = await getRepository();
    const health = await repo.health();

    return ok(
      {
        status: health.ok ? "healthy" : "degraded",
        persistence: {
          adapter: repo.kind,
          durable: repo.kind === "neon-postgres",
          detail: health.detail,
        },
        engine: ENGINE_VERSION,
        node: process.version,
      },
      { engineVersion: ENGINE_VERSION },
    );
  } catch (error) {
    return fail(error);
  }
}