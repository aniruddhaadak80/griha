"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

/**
 * Scannable QR code, rendered as inline SVG.
 *
 * The SVG is produced in the browser rather than shipped as a pre-rendered
 * image, so the encoded string can never drift out of sync with the URL actually
 * shown underneath it. If generation fails the component renders the link as
 * text instead — a broken QR that silently renders nothing would be worse than a
 * visible URL.
 *
 * `qrcode` is imported statically rather than dynamically: the dynamic form
 * pulled the package's Node entry point into the client bundle at runtime and
 * never resolved to a browser build, leaving an empty box.
 */
export function QrCode({
  value,
  size = 224,
  label,
}: {
  value: string;
  size?: number;
  label: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    QRCode.toString(value, {
      type: "svg",
      width: size,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#221b15", light: "#fffdf8" },
    })
      .then((svg) => {
        if (!cancelled && hostRef.current) hostRef.current.innerHTML = svg;
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (failed) {
    return (
      <div className="tile-sunk flex items-center justify-center p-3 text-center">
        <p className="stamp text-xs break-all text-ink-soft">{value}</p>
      </div>
    );
  }

  return (
    <div className="inline-flex flex-col items-center gap-2">
      <div
        ref={hostRef}
        role="img"
        aria-label={label}
        data-testid="qr-code"
        className="rounded-lg border-2 border-ink bg-plate p-2 [&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
        style={{ width: size }}
      />
      <p className="stamp max-w-[15rem] truncate text-[11px] text-ink-faint">{label}</p>
    </div>
  );
}