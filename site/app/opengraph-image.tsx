import { ImageResponse } from "next/og";

export const alt = "Hackshop — hardware-literate field guides";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#0a0a0a", color: "#f4f4f2", padding: "72px", fontFamily: "Arial, sans-serif" }}>
      <div style={{ display: "flex", fontSize: 34, fontWeight: 800 }}>hackshop</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ display: "flex", color: "#ff7a00", fontSize: 24, textTransform: "uppercase", letterSpacing: 5 }}>Field guides</div>
        <div style={{ display: "flex", maxWidth: 980, fontSize: 70, lineHeight: 1.02, fontWeight: 800 }}>Choose hardware you can actually hack.</div>
      </div>
    </div>,
    size,
  );
}
