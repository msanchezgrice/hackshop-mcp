"""FastAPI surface for the sim worker.

  POST /simulate            kick a job (async) or run bounded/sync inline
  GET  /simulate/{job_id}   poll status + artifact URLs
  GET  /healthz             liveness + mujoco version
  GET  /artifacts/...       static artifact files (mp4/json)

CORS is open so the Next.js app (any origin) can play artifacts directly.
"""

from __future__ import annotations

import os
from typing import Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import jobs
from .ir import SimulateRequest

app = FastAPI(title="hackshop-sim-worker", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/artifacts", StaticFiles(directory=str(jobs.RUNS_DIR)), name="artifacts")


def _base_url(request: Request) -> str:
    env = os.environ.get("PUBLIC_BASE_URL")
    if env:
        return env.rstrip("/")
    return str(request.base_url).rstrip("/")


def _with_urls(job: jobs.Job, request: Request) -> dict:
    payload = {
        "job_id": job.id,
        "status": job.status,
        "created_at": job.created_at,
        "finished_at": job.finished_at,
    }
    if job.error:
        payload["error"] = job.error
    if job.result:
        result = dict(job.result)
        base = _base_url(request)
        rels = result.get("artifacts", {}) or {}
        result["artifacts"] = {
            k: f"{base}/artifacts/{job.id}/{v}" for k, v in rels.items()
        }
        payload["result"] = result
    return payload


@app.get("/healthz")
def healthz() -> dict:
    info = {"ok": True}
    try:
        import mujoco

        info["mujoco"] = mujoco.__version__
    except Exception as e:  # pragma: no cover
        info["ok"] = False
        info["mujoco_error"] = str(e)
    return info


@app.post("/simulate")
def simulate(req: SimulateRequest, request: Request) -> dict:
    opts = req.options
    if opts.mode == "sync" or opts.bounded:
        job = jobs.run_sync(req.assembly, opts, req.build_plan, req.media)
    else:
        job = jobs.run_async(req.assembly, opts, req.build_plan, req.media)
    return _with_urls(job, request)


@app.get("/simulate/{job_id}")
def get_simulation(job_id: str, request: Request) -> dict:
    job = jobs.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    return _with_urls(job, request)
