import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.hackshop.dev"),
  title:
    "hackshop-mcp — an AI agent that knows what hardware is hackable, repurposable, or protocol-native",
  description:
    "An open-source MCP server that maps a project idea to hackable, repurposable, or protocol-native hardware. Tell your AI agent what you want to build; it returns 3-5 candidates with brick-risk, firmware links, and live eBay searches.",
  openGraph: {
    title: "hackshop-mcp",
    description:
      "Hardware-literate AI scout for tinkerers. Idea-to-hardware mapping via MCP.",
    type: "website",
    url: "https://www.hackshop.dev",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "Hackshop" }],
  },
  twitter: { card: "summary_large_image", images: ["/opengraph-image"] },
  alternates: { canonical: "/" },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
