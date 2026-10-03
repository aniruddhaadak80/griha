import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

/** App icon: the terracotta tile with the Griha glyph, on plaster. */
export default function Icon() {
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
          borderRadius: 96,
          padding: 64,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "100%",
            height: "100%",
            backgroundColor: "#c0391f",
            borderRadius: 64,
            border: "10px solid #221b15",
            color: "#fff8f3",
            fontSize: 200,
            fontWeight: 700,
          }}
        >
          G
        </div>
      </div>
    ),
    size,
  );
}