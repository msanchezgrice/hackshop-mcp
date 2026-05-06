import Link from "next/link";
import { DemoForm } from "@/components/DemoForm";

export default function Home() {
  return (
    <main>
      <header>
        <h1>hackshop</h1>
        <p className="tagline">
          An AI agent that knows{" "}
          <span style={{ color: "var(--accent)" }}>
            what hardware is hackable, repurposable, or protocol-native.
          </span>{" "}
          Tell it your project idea — get 3-5 candidates with brick-risk,
          firmware links, live eBay searches, a step-by-step how-to, and an
          AI-generated architecture diagram.
        </p>
        <div className="badges">
          <Link className="badge" href="/templates">
            23 templates
          </Link>
          <Link className="badge" href="/inventory">
            Your inventory
          </Link>
          <a className="badge" href="https://github.com/msanchezgrice/hackshop-mcp">
            GitHub
          </a>
        </div>
      </header>

      <h2>Try it</h2>
      <p style={{ fontSize: 14, color: "var(--muted)", marginTop: -4 }}>
        Need inspiration?{" "}
        <Link href="/templates">
          Browse 23 verified project templates →
        </Link>{" "}
        (old phone as a clock, e-paper calendar, Roomba as a robot, etc.)
      </p>
      <DemoForm />

      <h2>What you get</h2>
      <div className="grid">
        <div className="feature">
          <span className="num">3-5</span>
          <div className="title">Hardware candidates</div>
          <p className="desc">
            Each with hack difficulty, brick risk, community size, used-market
            price range, and an estimated setup time.
          </p>
        </div>
        <div className="feature">
          <span className="num">→</span>
          <div className="title">Live links</div>
          <p className="desc">
            Click straight through to current eBay listings, Hackaday articles,
            firmware repos, and Reddit hack threads.
          </p>
        </div>
        <div className="feature">
          <span className="num">📋</span>
          <div className="title">How-to guides</div>
          <p className="desc">
            One click generates a step-by-step walkthrough customized to your
            specific project — what to buy, what to flash, what can go wrong.
          </p>
        </div>
      </div>

      <h2>Use it from your own AI agent</h2>
      <p>
        hackshop is also an MCP server. Add this to Claude Desktop, Claude
        Code, Cursor, or any MCP-aware host:
      </p>
      <pre>
        <code>{`{
  "mcpServers": {
    "hackshop": {
      "command": "npx",
      "args": ["-y", "hackshop-mcp"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-..."
      }
    }
  }
}`}</code>
      </pre>

      <hr />

      <footer>
        <p>
          Open source, MIT-licensed.{" "}
          <a href="https://github.com/msanchezgrice/hackshop-mcp">Source on GitHub</a>{" "}
          ·{" "}
          <a href="https://www.npmjs.com/package/hackshop-mcp">npm</a> ·{" "}
          <a href="https://github.com/msanchezgrice/hackshop-mcp/issues">
            Suggest a device
          </a>
        </p>
      </footer>
    </main>
  );
}
