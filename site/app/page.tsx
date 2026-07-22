import Link from "next/link";
import { DemoForm } from "@/components/DemoForm";
import { TEMPLATE_COUNT } from "@/lib/templates";

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
        <nav className="badges" aria-label="Primary" data-agent-nav="primary">
          <Link className="badge" href="/templates" data-testid="nav-templates">
            {TEMPLATE_COUNT} templates
          </Link>
          <Link className="badge" href="/inventory" data-testid="nav-inventory">
            Your inventory
          </Link>
          <Link className="badge" href="/resources" data-testid="nav-resources">
            Field guides
          </Link>
          <a
            className="badge"
            href="https://github.com/msanchezgrice/hackshop-mcp"
            data-testid="nav-github"
          >
            GitHub
          </a>
        </nav>
      </header>

      <h2>Try it</h2>
      <p style={{ fontSize: 14, color: "var(--muted)", marginTop: -4 }}>
        Need inspiration?{" "}
        <Link href="/templates">
          Browse {TEMPLATE_COUNT} project templates →
        </Link>{" "}
        (old phone as a clock, e-paper calendar, Roomba as a robot, etc.)
      </p>
      <DemoForm />

      <h2>What you get</h2>
      <div className="grid">
        <div className="feature">
          <span className="icon" aria-hidden="true">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="4" y="4" width="16" height="16" rx="2" />
              <path d="M4 9h16M9 9v11" />
            </svg>
          </span>
          <div className="title">Hardware candidates</div>
          <p className="desc">
            3-5 options, each with hack difficulty, brick risk, community size,
            used-market price range, and an estimated setup time.
          </p>
        </div>
        <div className="feature">
          <span className="icon" aria-hidden="true">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07l-1.41 1.41" />
              <path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07l1.41-1.41" />
            </svg>
          </span>
          <div className="title">Live links</div>
          <p className="desc">
            Click straight through to current eBay listings, Hackaday articles,
            firmware repos, and Reddit hack threads.
          </p>
        </div>
        <div className="feature">
          <span className="icon" aria-hidden="true">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <path d="M14 2v6h6M8 13h8M8 17h5" />
            </svg>
          </span>
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
          </a>{" "}
          · <Link href="/resources">field guides</Link> · <Link href="/privacy">privacy</Link> ·{" "}
          <Link href="/terms">terms</Link> · <a href="/llms.txt">llms.txt</a> ·{" "}
          <a href="/agents.md">agents.md</a>
        </p>
      </footer>
    </main>
  );
}
