import type { Metadata } from "next";
import { loadCatalog } from "@/lib/catalog";
import { InventoryEditor } from "@/components/InventoryEditor";

export const metadata: Metadata = {
  title: "Your inventory · hackshop-mcp",
  description:
    "Add the hardware you already own. Hackshop will rank ideas you can build with what you have first, and only suggest new gear when the project genuinely benefits.",
};

export default function InventoryPage() {
  const { devices } = loadCatalog();
  const lite = devices
    .map((d) => ({
      id: d.id,
      name: d.name,
      category: d.category,
      image_url: d.image_url ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <main>
      <header>
        <h1>Your inventory</h1>
        <p className="tagline">
          Tell hackshop what hardware you already own. When inventory mode is
          on, the agent ranks ideas you can build right now first, then
          suggests additions.
        </p>
        <p style={{ color: "var(--muted)", fontSize: 13 }}>
          Stored locally in your browser. Nothing is sent to a server until you
          submit an idea.
        </p>
      </header>

      <InventoryEditor devices={lite} />

      <hr />

      <footer>
        <p>
          <a href="/">← Back to the agent</a> · {devices.length} devices in
          catalog ·{" "}
          <a href="https://github.com/msanchezgrice/hackshop-mcp/blob/main/CONTRIBUTING.md">
            request a missing device
          </a>
        </p>
      </footer>
    </main>
  );
}
