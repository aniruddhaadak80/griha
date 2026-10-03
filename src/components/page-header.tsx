import { site } from "@/config/site";
import { GitHubMark } from "@/components/github-mark";

export function PageHeader({
  eyebrow,
  title,
  lede,
  children,
}: {
  eyebrow: string;
  title: string;
  lede?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="border-b border-grout bg-plate/60">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-10">
        <p className="label">{eyebrow}</p>
        <h1 className="mt-2 font-display text-3xl leading-tight font-bold sm:text-4xl">{title}</h1>
        {lede ? <p className="mt-3 max-w-2xl text-base leading-relaxed text-ink-soft">{lede}</p> : null}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          {children}
          <a
            href={site.repo.url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary !min-h-9 !px-3 !py-1.5 !text-[13px]"
          >
            <GitHubMark />
            {site.repo.linkLabel}
          </a>
        </div>
      </div>
    </div>
  );
}