# Deploying the sim-worker

The Next.js site deploys to Vercel, but the **sim-worker can't run on Vercel** —
it needs MuJoCo + a software GL stack (OSMesa) + ffmpeg, which only run in a real
container. Host it on Fly.io (config included) and point the site at it.

## 1. Deploy the worker to Fly

```bash
cd sim-worker
fly launch --no-deploy     # first time only — keep the app name `hackshop-sim`
fly deploy                 # builds Dockerfile, ships it
fly status                 # note the URL, e.g. https://hackshop-sim.fly.dev
```

Set the worker's public base so artifact URLs (mp4 / summary.html / renders) come
back absolute and publicly reachable:

```bash
fly secrets set PUBLIC_BASE_URL=https://hackshop-sim.fly.dev
```

Optional — enable the builder-agent retry loop in prod (otherwise the scripted
baseline runs once, no retries):

```bash
fly secrets set ANTHROPIC_API_KEY=sk-ant-...
```

Smoke test:

```bash
curl https://hackshop-sim.fly.dev/healthz       # {"ok": true, "mujoco": "3.x.x"}
```

## 2. Point the site at the worker (in Vercel)

```bash
cd site
npx vercel env add SIM_WORKER_URL production     # https://hackshop-sim.fly.dev
npx vercel deploy --prod                          # or just push to main
```

Until `SIM_WORKER_URL` is set, the site's `/api/simulate` returns a clean 503
("Physics simulation isn't enabled on this deployment yet") and the rest of the
app keeps working — the Simulate button is the only thing gated.

## Where the agent retries

`hackshop_sim/agent/loop.py` — the `for i in range(max_iters)` loop authors a
controller, runs it, reads telemetry, and revises. It retries on (a) code that
fails to compile and (b) a run that misses the goal, feeding the failure summary
back to the LLM each time. Depth is `agent_max_iters` (default 3, capped 1–6).
Only active when the builder-agent toggle is on AND an LLM key is present.
