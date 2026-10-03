"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Download, Share2, Smartphone } from "lucide-react";
import { QrCode } from "@/components/qr-code";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type Platform = "android" | "ios" | "windows" | "macos" | "other";

/**
 * Install guide.
 *
 * Two jobs:
 *   1. offer the real install prompt where the browser provides one
 *      (`beforeinstallprompt`, Chromium on Android and desktop). If the browser
 *      has no such event, the button is replaced by the manual steps for that
 *      platform rather than left as a control that does nothing;
 *   2. give correct, specific instructions everywhere else, because iOS and
 *      macOS Safari have no install event at all.
 */
/** Detect the platform once, during the first render, from the user agent. */
function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (isIOS) return "ios";
  if (/Android/.test(ua)) return "android";
  if (/Windows/.test(ua)) return "windows";
  if (/Macintosh|Mac OS/.test(ua)) return "macos";
  return "other";
}

function detectInstalled(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

export function InstallPanel({ installUrl, boardUrl }: { installUrl: string; boardUrl: string }) {
  const [platform] = useState<Platform>(detectPlatform);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(detectInstalled);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Subscribing to an external signal, which is exactly what an effect is for:
    // the browser decides when an install prompt is available, and there is no
    // render-time event to read it from.
    const handler = (event: Event) => {
      // Suppress the mini-infobar so the page can present one clear button.
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);

    const installedHandler = () => setInstalled(true);
    window.addEventListener("appinstalled", installedHandler);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installedHandler);
    };
  }, []);

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    if (choice.outcome === "accepted") setInstalled(true);
    setDeferred(null);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(installUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked; the link is visible next to the button anyway.
    }
  }

  const steps: Record<Platform, string[]> = {
    android: [
      "Open this page in Chrome or Edge.",
      "Tap the browser menu, then “Install app” or “Add to Home screen”.",
      "Confirm. Griha gets its own icon and opens without browser chrome.",
    ],
    ios: [
      "Open this page in Safari — Chrome on iOS cannot install web apps.",
      "Tap the Share button in the toolbar.",
      "Choose “Add to Home Screen”, then Add.",
    ],
    windows: [
      "Open this page in Chrome or Edge on Windows.",
      "Click the install icon in the address bar, or open the menu and choose “Install Griha”.",
      "It pins to the taskbar and launches in its own window.",
    ],
    macos: [
      "Open this page in Safari.",
      "Choose File → “Add to Dock…”, or Share → “Add to Home Screen”.",
      "Griha appears in the Dock and in Spotlight.",
    ],
    other: [
      "Open this page in any Chromium-based browser.",
      "Use the install control in the address bar.",
      "If your browser has none, the app still works — bookmark it.",
    ],
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
      <div className="space-y-6">
        <section className="tile p-5">
          <p className="label">Step one</p>
          <h2 className="mt-1 font-display text-2xl font-semibold">Scan from a phone</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            Point any camera at this code. It opens Griha on the phone, which is already the right shape for a chore
            board — big tap targets, bottom-of-screen controls, and the install prompt waiting.
          </p>

          <div className="mt-5 flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            <div className="tile p-4">
              <QrCode value={installUrl} size={210} label={`Scan to open ${installUrl}`} />
            </div>

            <div className="flex-1">
              <p className="label">Or share the link</p>
              <code className="stamp mt-1 block break-all rounded-lg border border-grout bg-plate-sunk p-2.5 text-xs">
                {installUrl}
              </code>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" onClick={() => void copyLink()} className="btn btn-quiet !min-h-9 !px-3 !text-[13px]">
                  {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                  {copied ? "Copied" : "Copy link"}
                </button>
                {typeof navigator !== "undefined" && "share" in navigator ? (
                  <button
                    type="button"
                    onClick={() =>
                      void (navigator as Navigator & { share: (d: { title: string; url: string }) => Promise<void> }).share({
                        title: "Griha — household chore ledger",
                        url: installUrl,
                      })
                    }
                    className="btn btn-quiet !min-h-9 !px-3 !text-[13px]"
                  >
                    <Share2 size={14} aria-hidden="true" />
                    Share
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        <section className="tile p-5">
          <p className="label">Step two</p>
          <h2 className="mt-1 font-display text-2xl font-semibold">Install it</h2>

          {installed ? (
            <p className="mt-3 rounded-lg border-2 border-verdigris/50 bg-verdigris-wash p-3 text-sm text-verdigris">
              Griha is already running as an installed app in this browser. Nothing more to do.
            </p>
          ) : deferred ? (
            <button type="button" onClick={() => void install()} className="btn btn-primary mt-4" data-testid="install-button">
              <Download size={16} aria-hidden="true" />
              Install Griha
            </button>
          ) : (
            <p className="mt-3 rounded-lg border border-grout bg-plate-sunk p-3 text-xs leading-relaxed text-ink-soft">
              This browser did not offer an install prompt — which is expected on iOS and macOS Safari, and common in
              private windows. The steps on the right work everywhere.
            </p>
          )}

          <div className="mt-5">
            <p className="tile-label text-ink">
              On this device ({platform === "other" ? "detected as generic" : platform})
            </p>
            <ol className="mt-2 space-y-2">
              {steps[platform].map((step, index) => (
                <li key={step} className="flex gap-2.5 text-sm text-ink-soft">
                  <span className="stamp mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-ink text-[11px] font-bold">
                    {index + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </div>
        </section>
      </div>

      <div className="space-y-6">
        <section className="tile p-5">
          <p className="label">What you actually get</p>
          <ul className="mt-3 space-y-2.5 text-sm text-ink-soft">
            {[
              "An app icon on the home screen or taskbar, with its own window and no browser toolbar.",
              "A service worker that keeps the board readable offline and syncs when the network returns.",
              "The full data model in the browser cache — no store, no account, no 90 MB download.",
              "Automatic updates: a redeploy is the update, and there is nothing to approve.",
            ].map((item) => (
              <li key={item} className="flex gap-2">
                <Smartphone size={15} className="mt-0.5 shrink-0 text-verdigris" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </section>

        <section className="tile p-5">
          <p className="label">Start here after installing</p>
          <h2 className="mt-1 font-display text-xl font-semibold">Your board lives behind this link</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            Households are anonymous: your board belongs to the browser that created it, via an HTTP-only cookie. Opening
            the board on a second device means opening the share link from Export, which is read-only by design.
          </p>
          <a href={boardUrl} className="btn btn-secondary mt-4">
            Open the board
          </a>
        </section>

        <section className="tile p-5">
          <p className="label">Being straight about this</p>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            Griha is an installable progressive web app, not a native binary. It will not appear in the App Store or Play
            Store, it cannot be listed as a background-enabled app, and iOS gives it no push notifications without
            adding to the home screen first. In exchange it is one codebase, updates the instant it is deployed, runs
            on every platform from a single URL, and needs no signing certificate or store fee.
          </p>
        </section>
      </div>
    </div>
  );
}