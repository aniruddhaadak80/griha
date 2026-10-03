/**
 * Single source of truth for every public-facing string that appears in more
 * than one place: navigation, footer, landing CTA, OpenGraph tags, the web
 * manifest and the MCP descriptor.
 *
 * The repository URL is deliberately declared once. Header, mobile menu, footer
 * and the landing CTA all read `site.repo.url`, so there is no way for them to
 * drift apart.
 */

export const site = {
  name: "Griha",
  /** Devanagari for "home". The product is a home, and the ledger lives in it. */
  wordmark: "गृह",
  tagline: "The household chore ledger that shows its working.",
  description:
    "A shared, tamper-evident chore ledger for family and friends. Claim a chore in one tap, see exactly who owes what with itemised arithmetic, and let an open-weights TabPFN model running entirely in your browser predict which chore is about to be dropped.",
  oneLiner: "A fair chore ledger for the people you live with.",

  /** Used for canonical URLs, OpenGraph, sitemap and the manifest start_url. */
  url: "https://griha.vercel.app",

  repo: {
    url: "https://github.com/aniruddhaadak80/griha",
    /** Visible text used in navigation, the footer and the landing CTA. */
    linkLabel: "View source",
    /**
     * Every GitHub link in the app carries visible text, so that text is its
     * accessible name and the icon beside it is `aria-hidden`.
     *
     * There is deliberately no `aria-label` on those links. An `aria-label` that
     * does not contain the visible label breaks WCAG 2.5.3 "Label in Name" and
     * stops voice-control users naming the link by what they can see.
     */
  },

  author: "aniruddhaadak80",

  nav: [
    { href: "/board", label: "Board" },
    { href: "/fairness", label: "Fairness" },
    { href: "/agent", label: "Agent" },
    { href: "/export", label: "Export" },
    { href: "/install", label: "Install" },
  ] as const,

  /** Third-party data Griha reads. Both are key-free public APIs. */
  sources: [
    {
      name: "Open-Meteo",
      href: "https://open-meteo.com/",
      what: "weather forecast used to score outdoor chores",
    },
    {
      name: "Nager.Date",
      href: "https://date.nager.at/",
      what: "public holidays used to move work off days nobody is home",
    },
  ],

  /** Shown next to the TabPFN panel; required by the Prior Labs model licence. */
  tabpfnAttribution: "Built with PriorLabs-TabPFN",
} as const;

export type NavItem = (typeof site.nav)[number];