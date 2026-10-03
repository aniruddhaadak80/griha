import Link from "next/link";
import { site } from "@/config/site";
import { GitHubMark } from "@/components/github-mark";

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-16 border-t-2 border-ink bg-plate">
      <div className="mx-auto w-full max-w-6xl px-4 py-10">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="font-display text-xl font-semibold">{site.name}</p>
            <p className="mt-1 text-sm text-ink-soft">{site.tagline}</p>
          </div>

          <nav aria-label="Product">
            <p className="label">Product</p>
            <ul className="mt-2 space-y-1.5 text-sm">
              {site.nav.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="text-ink-soft underline-offset-4 hover:text-ink hover:underline">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="Source">
            <p className="label">Source</p>
            <ul className="mt-2 space-y-1.5 text-sm">
              <li>
                <a
                  href={site.repo.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-ink-soft underline-offset-4 hover:text-ink hover:underline"
                >
                  <GitHubMark />
                  {site.repo.linkLabel}
                </a>
              </li>
              <li>
                <a
                  href={`${site.repo.url}/issues`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-ink-soft underline-offset-4 hover:text-ink hover:underline"
                >
                  Report an issue
                </a>
              </li>
              <li>
                <Link href="/agent" className="text-ink-soft underline-offset-4 hover:text-ink hover:underline">
                  Agent tools
                </Link>
              </li>
              <li>
                <a
                  href="/mcp.json"
                  className="text-ink-soft underline-offset-4 hover:text-ink hover:underline"
                >
                  mcp.json
                </a>
              </li>
            </ul>
          </nav>

          <div>
            <p className="label">Data</p>
            <ul className="mt-2 space-y-1.5 text-sm">
              {site.sources.map((source) => (
                <li key={source.name}>
                  <a
                    href={source.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-ink-soft underline-offset-4 hover:text-ink hover:underline"
                  >
                    {source.name}
                  </a>
                  <span className="block text-xs text-ink-faint">{source.what}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-3 border-t border-grout pt-5 text-xs text-ink-faint sm:flex-row sm:items-center sm:justify-between">
          <p>
            MIT licensed · {site.name} {year} · Built by{" "}
            <a
              href={`https://github.com/${site.author}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4 hover:text-ink"
            >
              {site.author}
            </a>
          </p>
          <p>
            Household chores are not a medical, legal or safety system.{" "}
            <span className="text-ink-faint">{site.tabpfnAttribution}.</span>
          </p>
        </div>
      </div>
    </footer>
  );
}