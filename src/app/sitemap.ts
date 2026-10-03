import type { MetadataRoute } from "next";
import { site } from "@/config/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const staticRoutes = [
    { path: "", priority: 1 },
    { path: "/board", priority: 0.9 },
    { path: "/fairness", priority: 0.8 },
    { path: "/install", priority: 0.8 },
    { path: "/export", priority: 0.7 },
    { path: "/agent", priority: 0.7 },
    { path: "/settings", priority: 0.5 },
    { path: "/verify", priority: 0.5 },
  ];

  return staticRoutes.map((route) => ({
    url: `${site.url}${route.path}`,
    lastModified: now,
    changeFrequency: "weekly" as const,
    priority: route.priority,
  }));
}