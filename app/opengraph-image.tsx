import { ImageResponse } from "next/og";

export const alt = "SEO AI Audit — make content easier for AI search systems to extract and cite";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "72px",
        background: "#f6f5f1",
        color: "#161616",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "18px", fontSize: 26, letterSpacing: 3 }}>
        <span style={{ color: "#0b66e4" }}>●</span> SEO AI AUDIT
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "22px", maxWidth: 970 }}>
        <div style={{ fontSize: 72, fontWeight: 700, letterSpacing: -3, lineHeight: 1.05 }}>
          Make your content easier to extract and cite.
        </div>
        <div style={{ fontSize: 29, color: "#555" }}>
          AEO · GEO · Citability · AI Overview readiness
        </div>
      </div>
      <div style={{ display: "flex", gap: "12px" }}>
        {["18 signals", "Evidence-backed", "No signup"].map((label) => (
          <span key={label} style={{ border: "2px solid #bbb", padding: "10px 18px", fontSize: 20 }}>{label}</span>
        ))}
      </div>
    </div>,
    size,
  );
}
