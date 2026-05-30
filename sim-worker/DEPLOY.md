# Deploying the sim-worker

The Next.js site deploys to Vercel, but the **sim-worker can't run on Vercel** —
it needs MuJoCo + a software GL stack (OSMesa) + ffmpeg, which only run in a real
container. Host it on Fly.io (config included) and point the site at it.

## 1. Deploy the worker to Fly

```bash
cd sim-worker
fly apps create hackshop-sim -o personal   # first time only
fly deploy                                  # builds Dockerfile, ships it
fly status                                  # note the URL, e.g. https://hackshop-sim.fly.dev
```

### If `fly deploy` fails with a registry `401 Unauthorized`

Fly's remote builder sometimes can't push to its internal registry
(`...HEAD request to http://_api.internal:5000/... 401 Unauthorized`). This is a
builder-token issue `fly auth docker` alone can't fix. Work around it by building
locally and pushing the image straight to the Fly registry, then releasing it.
Your Mac is arm64 and Fly runs amd64, so you **must** cross-build for amd64:

```bash
flyctl auth docker
docker buildx build --platform linux/amd64 -t registry.fly.io/hackshop-sim:deploy-1 --push .
flyctl deploy --image registry.fly.io/hackshop-sim:deploy-1
```

> `fly deploy` may print `timeout reached waiting for health checks` even when the
> deploy actually succeeded (the CLI's health poll times out over a slow OSMesa
> boot). Always confirm with `fly machines list` + `curl /healthz` before retrying.

Set the worker's public base so artifact URLs (mp4 / summary.html / renders) come
back absolute and publicly reachable:

```bash
fly secrets set PUBLIC_BASE_URL=https://hackshop-sim.fly.dev
```

### Artifact persistence (REQUIRED — otherwise links 404)

Artifacts are written to `/app/runs` (`HACKSHOP_RUNS_DIR`). Without a persistent
volume they live in the ephemeral container fs and **vanish on every machine
stop/restart** — so with `min_machines_running = 0` the `/artifacts/...` links
start returning `{"detail":"Not Found"}` as soon as the machine idles down.

Attach a volume and run **exactly one machine** (a Fly volume binds to a single
machine, so multi-machine + volume would still mismatch on reads):

```bash
fly scale count 1 -a hackshop-sim --yes
fly volumes create runs --region iad --size 3 -a hackshop-sim --yes
fly deploy --image registry.fly.io/hackshop-sim:deploy-1   # attaches volume at /app/runs
```

`fly.toml` already declares the `[mounts]` block. Verify the volume is attached
(`fly volumes list` shows an `ATTACHED VM`) and that an artifact survives a
restart:

```bash
fly machines restart <id> -a hackshop-sim
curl -o /dev/null -w "%{http_code}\n" https://hackshop-sim.fly.dev/artifacts/<run>/summary.html
```

To scale past one machine, move artifacts off the volume into object storage
(Fly **Tigris**/S3) since volumes are not shared across machines.

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
