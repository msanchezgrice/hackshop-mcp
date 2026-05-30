"""In-memory job store + on-disk artifact directories.

Stateless-by-restart (fine for a single worker / dev): jobs live in a dict,
artifacts under RUNS_DIR/<job_id>/. A production deploy would back this with
object storage + a durable queue, but the HTTP contract stays the same.
"""

from __future__ import annotations

import os
import threading
import time
import traceback
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

from .ir import Assembly, BuildPlanIR, ComponentMedia, SimulateOptions
from .pipeline import run_pipeline

RUNS_DIR = Path(
    os.environ.get("HACKSHOP_RUNS_DIR")
    or (Path(__file__).resolve().parent.parent / "runs")
)
RUNS_DIR.mkdir(parents=True, exist_ok=True)


@dataclass
class Job:
    id: str
    status: str = "queued"  # queued | running | done | error
    created_at: float = field(default_factory=time.time)
    finished_at: Optional[float] = None
    result: Optional[dict] = None
    error: Optional[str] = None


_JOBS: Dict[str, Job] = {}
_LOCK = threading.Lock()


def job_dir(job_id: str) -> Path:
    return RUNS_DIR / job_id


def create_job() -> Job:
    job = Job(id=uuid.uuid4().hex[:12])
    with _LOCK:
        _JOBS[job.id] = job
    return job


def get_job(job_id: str) -> Optional[Job]:
    with _LOCK:
        return _JOBS.get(job_id)


def _execute(
    job: Job,
    assembly: Assembly,
    options: SimulateOptions,
    build_plan: Optional[BuildPlanIR],
    media: List[ComponentMedia],
) -> None:
    with _LOCK:
        job.status = "running"
    try:
        result = run_pipeline(assembly, options, job_dir(job.id), build_plan, media)
        with _LOCK:
            job.result = result
            job.status = "done"
            job.finished_at = time.time()
    except Exception as e:  # pragma: no cover - surfaced via job.error
        with _LOCK:
            job.error = f"{e}\n{traceback.format_exc()}"
            job.status = "error"
            job.finished_at = time.time()


def run_sync(
    assembly: Assembly,
    options: SimulateOptions,
    build_plan: Optional[BuildPlanIR] = None,
    media: Optional[List[ComponentMedia]] = None,
) -> Job:
    job = create_job()
    _execute(job, assembly, options, build_plan, media or [])
    return job


def run_async(
    assembly: Assembly,
    options: SimulateOptions,
    build_plan: Optional[BuildPlanIR] = None,
    media: Optional[List[ComponentMedia]] = None,
) -> Job:
    job = create_job()
    t = threading.Thread(
        target=_execute, args=(job, assembly, options, build_plan, media or []), daemon=True
    )
    t.start()
    return job
