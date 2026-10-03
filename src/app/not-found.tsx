import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-16">
      <p className="label">404</p>
      <h1 className="mt-2 font-display text-3xl font-bold">There is no such page</h1>
      <p className="mt-4 leading-relaxed text-ink-soft">
        The board, the fairness report and the agent console are all one click away. If you followed a share link, it
        may have been rotated or the household may have been reset.
      </p>
      <div className="mt-6 flex flex-wrap gap-2">
        <Link href="/board" className="btn btn-primary">
          Open the board
        </Link>
        <Link href="/" className="btn btn-secondary">
          Back to the start
        </Link>
      </div>
    </div>
  );
}