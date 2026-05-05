import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "hackshop-mcp — an AI agent that knows what hardware is hackable",
  description:
    "An open-source MCP server that maps a project idea to hackable hardware. Tell your AI agent what you want to build; it returns 3-5 candidates with brick-risk, firmware links, and live eBay searches.",
  openGraph: {
    title: "hackshop-mcp",
    description:
      "Hardware-literate AI scout for tinkerers. Idea-to-hardware mapping via MCP.",
    type: "website",
  },
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
