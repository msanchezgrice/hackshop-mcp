import Link from "next/link";
import { DemoForm } from "@/components/DemoForm";

export default function Home() {
  return (
    <main>
      <header>
        <h1>hackshop-mcp</h1>
        <p className="tagline">
          An AI agent that knows{" "}
          <span style={{ color: "var(--accent)" }}>
            what hardware is hackable.
          </span>{" "}
          Tell it your project idea; it returns 3-5 candidates from a hand-vetted
          catalog with brick-risk, firmware links, and live eBay searches.
        </p>
        <div className="badges">
          <a className="badge" href="https://github.com/msanchezgrice/hackshop-mcp">
            GitHub
          </a>
          <a className="badge" href="https://www.npmjs.com/package/hackshop-mcp">
            npm
          </a>
          <span className="badge">MIT</span>
          <span className="badge">v0.0.2</span>
        </div>
      </header>

      <h2>Try it live</h2>
      <p>
        Real API call to a real catalog. Submit a project idea below and the
        agent picks 3-5 candidates with reasoning. The same logic ships in the
        npm package; this page is the proof.
      </p>
      <p style={{ fontSize: 14, color: "var(--muted)" }}>
        Need inspiration?{" "}
        <Link href="/templates">
          Browse 25 verified project templates →
        </Link>{" "}
        (old phone as a clock, e-paper calendar, Roomba as a robot, etc.)
      </p>
      <DemoForm />

      <h2>Install in 30 seconds</h2>
      <p>
        Add this to your MCP client config (Claude Desktop, Claude Code, or any
        MCP-aware host):
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
      <p className="install-note">
        The <code>ANTHROPIC_API_KEY</code> is optional but recommended. The
        server prefers MCP <code>sampling/createMessage</code> for reasoning;
        if your host doesn&apos;t support it, the server falls back to a direct
        Anthropic call when this key is set.
      </p>

      <h2>The story</h2>
      <p>
        I had an Electric Objects EO1 picture frame. The company shut down. The
        frame bricked. It took six hours of forum-diving and Claude assistance
        to revive it. The hack was fun. Finding what hardware is even hackable
        was the time-sink.
      </p>
      <p>
        hackshop-mcp closes that gap. Two MCP tools. 27 hand-vetted devices. A
        strict safety rule for hardware classes where bricks are unrecoverable.
        Built so an agent can do the part you don&apos;t know how to do.
      </p>

      <h2>What&apos;s in the box</h2>
      <div className="grid">
        <div className="feature">
          <span className="num">27</span>
          <div className="title">Hand-vetted devices</div>
          <p className="desc">
            Each entry has explicit brick-risk provenance: founder-verified,
            community-reported, or LLM-inferred.
          </p>
        </div>
        <div className="feature">
          <span className="num">2</span>
          <div className="title">MCP tools</div>
          <p className="desc">
            <code>propose_hardware</code> for idea-to-device mapping.{" "}
            <code>assess_hackability</code> for direct lookups.
          </p>
        </div>
        <div className="feature">
          <span className="num">P0</span>
          <div className="title">Safety rule</div>
          <p className="desc">
            For handhelds and SBCs with LLM-inferred risk, the server refuses
            to surface a fabricated brick-risk score. Tested as a release gate.
          </p>
        </div>
      </div>

      <h2>Design choices worth noting</h2>
      <ul>
        <li>
          <strong>Compose, don&apos;t vendor.</strong> hackshop-mcp doesn&apos;t bundle
          eBay integration. Every proposal returns an eBay search URL the host
          can hand to{" "}
          <a href="https://github.com/YosefHayim/ebay-mcp">ebay-mcp</a> for live
          listings. Two MCP servers, one workflow.
        </li>
        <li>
          <strong>Sampling first, API fallback.</strong> The server prefers
          MCP&apos;s <code>sampling/createMessage</code> so users don&apos;t ship a key.
          When the host doesn&apos;t support sampling, an env-gated Anthropic API
          fallback kicks in.
        </li>
        <li>
          <strong>Closed-set tag vocabulary.</strong> 24 tags in{" "}
          <code>tags.md</code>; boot validation refuses to start if catalog
          drifts. No 70-tag mess in three months.
        </li>
        <li>
          <strong>JSON catalog, not SQLite.</strong> 27 devices fit in a
          diffable file. Community contributions are a PR.
        </li>
      </ul>

      <h2>Contributing devices</h2>
      <p>
        The catalog is the moat. PRs welcome — see{" "}
        <a href="https://github.com/msanchezgrice/hackshop-mcp/blob/main/CONTRIBUTING.md">
          CONTRIBUTING.md
        </a>
        . New entries default to <code>community-reported</code> provenance;{" "}
        <code>founder-verified</code> requires the maintainer&apos;s signature.
        Adding a tag means editing <code>tags.md</code> in the same PR.
      </p>

      <h2>Status</h2>
      <p>
        V0.0.2 is the demand experiment. If installs and issue traffic clear a
        stretch threshold, V0.1 expands the catalog and adds a third tool. If
        not, the package keeps existing as a personal tool — that&apos;s the deal
        with N=1 builder mode.
      </p>

      <hr />

      <footer>
        <p>
          Built by{" "}
          <a href="https://github.com/msanchezgrice">@msanchezgrice</a>.
          MIT-licensed.{" "}
          <a href="https://github.com/msanchezgrice/hackshop-mcp">Source</a> ·{" "}
          <a href="https://www.npmjs.com/package/hackshop-mcp">npm</a> ·{" "}
          <a href="https://github.com/msanchezgrice/hackshop-mcp/issues">
            Issues
          </a>
        </p>
      </footer>
    </main>
  );
}
