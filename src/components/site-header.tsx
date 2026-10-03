"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { site } from "@/config/site";
import { GitHubMark } from "@/components/github-mark";

/**
 * Shared navigation.
 *
 * The GitHub link is present in the desktop bar, inside the mobile drawer, and
 * again in the footer, and all three read `site.repo.url` — there is exactly one
 * place the repository URL is written down.
 *
 * The drawer closes on link activation rather than in an effect keyed to the
 * pathname: closing is a consequence of the navigation the user just performed,
 * not of the route changing on its own.
 */
export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="nav-plate sticky top-0 z-50">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-2.5">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 rounded-lg py-1 pr-2 font-display text-lg font-semibold"
        >
          <span
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded-lg border-2 border-ink bg-terracotta text-base font-bold text-white"
          >
            ग
          </span>
          <span className="hidden sm:inline">{site.name}</span>
        </Link>

        <nav aria-label="Main" className="ml-2 hidden items-center gap-1 md:flex">
{site.nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                aria-current={isActive(item.href) ? "page" : undefined}
                className={`rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors ${
                  isActive(item.href)
                    ? "bg-ink text-plaster"
                    : "text-ink-soft hover:bg-grout-soft hover:text-ink"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <a
              href={site.repo.url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary hidden !min-h-9 !px-3 !py-1.5 !text-[13px] sm:inline-flex"
            >
              <GitHubMark />
              {site.repo.linkLabel}
            </a>

            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-controls="mobile-nav"
              className="btn btn-secondary !min-h-9 !px-2.5 md:hidden"
            >
              {open ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
              <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
            </button>
          </div>
        </div>

        {open ? (
          <div id="mobile-nav" className="border-t-2 border-ink bg-plaster md:hidden">
            <nav aria-label="Main" className="mx-auto flex w-full max-w-6xl flex-col gap-1 px-4 py-3">
              {site.nav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  aria-current={isActive(item.href) ? "page" : undefined}
                  className={`rounded-lg px-3 py-2.5 text-sm font-medium ${
                    isActive(item.href) ? "bg-ink text-plaster" : "text-ink-soft"
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            <a
              href={site.repo.url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary mt-2 w-full"
            >
              <GitHubMark />
              {site.repo.linkLabel}
            </a>
          </nav>
        </div>
      ) : null}
    </header>
  );
}