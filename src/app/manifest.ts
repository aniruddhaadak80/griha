/**
 * Web app manifest — this file is what makes Griha installable.
 *
 * The same manifest is what an Android home screen, an iOS Add to Home Screen,
 * a Windows taskbar pin, a macOS Dock tile and a browser's install dialog all
 * read, which is how one codebase covers every device Griha claims to support.
 *
 * `start_url` deliberately omits a query string so the installed app opens the
 * board, not a stale filter.
 */
import type { MetadataRoute } from "next";
import { site } from "@/config/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${site.name} — ${site.tagline}`,
    short_name: site.name,
    description: site.description,
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui", "browser"],
    orientation: "portrait-primary",
    background_color: "#fbf7ee",
    theme_color: "#fbf7ee",
    lang: "en",
    dir: "ltr",
    categories: ["productivity", "lifestyle", "utilities"],
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
    shortcuts: [
      { name: "Chore board", short_name: "Board", url: "/board" },
      { name: "Fairness report", short_name: "Fairness", url: "/fairness" },
      { name: "Export", short_name: "Export", url: "/export" },
    ],
  };
}