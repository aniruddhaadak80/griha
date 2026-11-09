import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { ServiceWorkerRegistrar } from "@/components/service-worker-registrar";
import { site } from "@/config/site";
import "./globals.css";

// Self-hosted variable fonts. `next/font/google` fetches Google Fonts CSS at
// build time, which fails in CI when that egress is unavailable and breaks
// the Turbopack font loader with "next/font/google queries have exactly one
// entry". Local fonts remove the build-time network dependency entirely.
const fraunces = localFont({
  src: "./fonts/fraunces.woff2",
  variable: "--font-fraunces",
  weight: "400 700",
  display: "swap",
});

const outfit = localFont({
  src: "./fonts/outfit.woff2",
  variable: "--font-outfit",
  weight: "300 700",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: `${site.name} — ${site.oneLiner}`,
    template: `%s · ${site.name}`,
  },
  description: site.description,
  applicationName: site.name,
  authors: [{ name: site.author, url: `https://github.com/${site.author}` }],
  creator: site.author,
  keywords: [
    "household chores",
    "chore fairness",
    "shared home",
    "family rota",
    "TabPFN",
    "open source AI",
    "progressive web app",
    "installable app",
  ],
  manifest: "/manifest.webmanifest",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: site.url,
    siteName: site.name,
    title: `${site.name} — ${site.oneLiner}`,
    description: site.description,
    locale: "en_GB",
  },
  twitter: {
    card: "summary_large_image",
    title: `${site.name} — ${site.oneLiner}`,
    description: site.description,
  },
  appleWebApp: {
    capable: true,
    title: site.name,
    // Tile colour must match the manifest or iOS renders a white flash.
    statusBarStyle: "default",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbf7ee" },
    { media: "(prefers-color-scheme: dark)", color: "#221b15" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${fraunces.variable} ${outfit.variable} h-full`}>
      <body className="flex min-h-dvh flex-col">
        <a href="#main" className="skip-link">
          Skip to main content
        </a>
        <ServiceWorkerRegistrar />
        <SiteHeader />
        <main id="main" className="flex-1">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}