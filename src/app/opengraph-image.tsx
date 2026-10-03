import { ImageResponse } from "next/og";
import { site } from "@/config/site";

export const alt = `${site.name} — ${site.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * OpenGraph card, rendered at build time.
 *
 * It shows the actual product: the fair-share bar with three real shares and
 * the engine version. A marketing hero would prove nothing about a ledger, so
 * the card is the interface.
 */
export default async function OpengraphImage() {
  const shares = [
    { name: "Aarav", pct: 41, color: "#c0391f" },
    { name: "Ishita", pct: 34, color: "#1f6b5e" },
    { name: "Nani", pct: 25, color: "#2b4a78" },
  ];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#fbf7ee",
          padding: 64,
          fontFamily: "sans-serif",
          color: "#221b15",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 60,
              height: 60,
              borderRadius: 14,
              border: "3px solid #221b15",
              backgroundColor: "#c0391f",
              color: "#fff8f3",
              fontSize: 34,
              fontWeight: 700,
            }}
          >
            G
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 34, fontWeight: 700 }}>{site.name}</div>
            <div style={{ fontSize: 20, color: "#58493c" }}>{site.tagline}</div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ fontSize: 22, letterSpacing: 4, color: "#8a7867", fontWeight: 600 }}>
            FAIR SHARE · LAST 28 DAYS
          </div>
          <div
            style={{
              display: "flex",
              height: 54,
              borderRadius: 999,
              border: "3px solid #221b15",
              overflow: "hidden",
              backgroundColor: "#efe6d5",
            }}
          >
            {shares.map((share, index) => (
              <div
                key={share.name}
                style={{
                  display: "flex",
                  width: `${share.pct}%`,
                  backgroundColor: share.color,
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fffdf8",
                  fontSize: 20,
                  fontWeight: 700,
                  borderRight: index < shares.length - 1 ? "3px solid #221b15" : "none",
                }}
              >
                {share.name} {share.pct}%
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 20, fontSize: 19, color: "#58493c" }}>
            <span>griha-fairness/2026.10.1</span>
            <span>·</span>
            <span>SHA-384 sealed ledger</span>
            <span>·</span>
            <span>TabPFN runs in your browser</span>
          </div>
        </div>
      </div>
    ),
    size,
  );
}