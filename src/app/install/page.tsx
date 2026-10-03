import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { InstallPanel } from "@/components/install-panel";
import { site } from "@/config/site";

export const metadata: Metadata = {
  title: "Install",
  description:
    "Install Griha on Android, iPhone, Windows, macOS or any browser. One installable progressive web app, no store account, with a scannable QR code.",
  alternates: { canonical: "/install" },
};

/**
 * Cross-platform install guide.
 *
 * The claim on this page is precise and checkable: Griha is an installable
 * progressive web app, so "install" means an app icon on the home screen or taskbar
 * with its own window chrome, running offline from a service worker. It is not a
 * wrapper and not a store listing, and the page says so plainly rather than
 * implying an APK exists.
 */
export default function InstallPage() {
  return (
    <>
      <PageHeader
        eyebrow="Every device"
        title="Install Griha"
        lede="One codebase serves Android, iPhone, Windows, macOS, Linux and any browser. There is no store account, no APK to sideload, and no separate desktop build to keep in sync — the same URL installs everywhere."
      />

      <div className="mx-auto w-full max-w-6xl px-4 py-8">
        <InstallPanel installUrl={`${site.url}/install`} boardUrl={`${site.url}/board`} />
      </div>
    </>
  );
}