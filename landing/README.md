# Landing page

Single self-contained `index.html`. No build step, no JS, no analytics, no cookie banner. Open `index.html` in a browser to preview locally.

## Hosting

### Option A — GitHub Pages (recommended, free, auto-deploy)

The repo includes `.github/workflows/deploy-pages.yml` which auto-deploys this folder to GitHub Pages on every push to `main` that touches `landing/`.

One-time setup:

1. Go to https://github.com/msanchezgrice/hackshop-mcp/settings/pages
2. Source: **GitHub Actions** (not "Deploy from a branch")
3. Save

After the next push, the page will be live at:

  https://msanchezgrice.github.io/hackshop-mcp/

### Option B — Vercel (custom domain, edge cache)

```bash
cd landing
npx vercel --prod
```

Hit the prompts. Set the project root to `landing/`. No framework preset needed.

### Option C — Drag and drop

The whole site is one file. Drag `landing/index.html` into Netlify Drop, Cloudflare Pages, or any static host.

## Editing

Everything is in `landing/index.html`. Inline CSS, inline content. Minimum-viable.

When you're ready for a real product page (V1.x), promote this to its own framework — Next.js + Vercel is the natural path, reusing the catalog as a library per the V1 design doc.
