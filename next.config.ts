import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Keep the database drivers out of the server bundle.
   *
   * `@electric-sql/pglite` is a Postgres compiled to WebAssembly: it resolves
   * its own `.wasm` asset relative to the module and instantiates it at import
   * time. Letting the bundler inline either of those produces a server runtime
   * that throws `path argument must be of type string…` and, in the React
   * Server Component runtime, takes the whole process down with it. Marking the
   * package as external makes Node resolve it from `node_modules` at runtime,
   * which is the only way the embedded database works inside Next.
   *
   * `@neondatabase/serverless` is listed for the same reason: it is an HTTP
   * client rather than a native module, but keeping it external avoids the
   * bundler rewriting its fetch path.
   */
  serverExternalPackages: ["@electric-sql/pglite", "@neondatabase/serverless"],

  /**
   * Typed routes, so a mistyped `href` is a compile error rather than a 404
   * found by a user.
   */
  typedRoutes: true,

  /**
   * The service worker must never be cached, or a stale worker can keep serving
   * an old shell after a deploy. Next serves `/sw.js` from `public/`, so the
   * header is set here rather than in middleware.
   */
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
      {
        // A household board is per-session and must never sit in a shared cache.
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
    ];
  },
};

export default nextConfig;