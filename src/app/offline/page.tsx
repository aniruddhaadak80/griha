import Link from "next/link";

export default function OfflinePage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-16">
      <p className="label">Offline</p>
      <h1 className="mt-2 font-display text-3xl font-bold">Griha could not reach the network</h1>
      <p className="mt-4 leading-relaxed text-ink-soft">
        This page is served by the offline shell, which means the device is offline or the server is unreachable.
        Anything you had already loaded should still be readable below the header.
      </p>
      <div className="mt-6 flex flex-wrap gap-2">
        <Link href="/board" className="btn btn-primary">
          Try the board again
        </Link>
        <Link href="/install" className="btn btn-secondary">
          Install Griha
        </Link>
      </div>
    </div>
  );
}