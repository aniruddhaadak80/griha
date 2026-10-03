import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** iOS home-screen icon. iOS does not maskable-crop, so this stays full bleed. */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#fbf7ee",
          color: "#c0391f",
          fontSize: 118,
          fontWeight: 700,
        }}
      >
        G
      </div>
    ),
    size,
  );
}