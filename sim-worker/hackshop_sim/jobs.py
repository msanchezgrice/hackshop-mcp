"""Job store with disk-backed durability + on-disk artifact directories.

Jobs live in a dict for the live process, but every state transition is also
persisted to RUNS_DIR/<job_id>/job.json (atomic write). The pipeline writes
result.json LAST and atomically, so its presence is the canonical "this job
finished" marker. On a GET miss after a restart we reconstruct a terminal Job
by reading those files instead of returning a spurious 404 — the in-process dict
losing state no longer loses the job.

A production deploy would back this with object storage + a durable queue, but
the HTTP contract stays the same.
"""

from __future__ import annotations

import json
import os
import tempfile
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

_JOB_RECORD = "job.json"
_RESULT_FILE = "result.json"


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


def _atomic_write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(payload, f)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def _persist(job: Job) -> None:
    """Persist a small status record next to the artifacts (idempotent)."""
    try:
        _atomic_write_json(
            job_dir(job.id) / _JOB_RECORD,
            {
                "id": job.id,
                "status": job.status,
                "created_at": job.created_at,
                "finished_at": job.finished_at,
                "error": job.error,
            },
        )
    except Exception as e:  # pragma: no cover - persistence is best-effort
        print(f"[jobs] failed to persist job {job.id}: {e}")


def _reconstruct_from_disk(job_id: str) -> Optional[Job]:
    """Rebuild a Job from RUNS_DIR/<job_id>/ after the in-process dict lost it.

    Priority: result.json (terminal 'done' with the full result) > job.json
    (status record, e.g. 'error') > artifact presence heuristic. Returns None if
    nothing on disk corresponds to the id (a true 404).
    """
    d = job_dir(job_id)
    if not d.is_dir():
        return None

    record: dict = {}
    rec_path = d / _JOB_RECORD
    if rec_path.is_file():
        try:
            record = json.loads(rec_path.read_text())
        except Exception:
            record = {}

    # result.json present => the pipeline finished writing every artifact.
    res_path = d / _RESULT_FILE
    if res_path.is_file():
        try:
            result = json.loads(res_path.read_text())
        except Exception:
            result = None
        if result is not None:
            # 'unsupported' results are terminal too, but carry supported=False.
            return Job(
                id=job_id,
                status="done",
                created_at=record.get("created_at") or os.path.getmtime(d),
                finished_at=record.get("finished_at") or os.path.getmtime(res_path),
                result=result,
            )

    # A persisted error record (e.g. the run crashed before result.json).
    if record.get("status") == "error":
        return Job(
            id=job_id,
            status="error",
            created_at=record.get("created_at") or os.path.getmtime(d),
            finished_at=record.get("finished_at"),
            error=record.get("error") or "job failed (reconstructed from disk)",
        )

    # Fallback heuristic: a finished run leaves telemetry + summary even if
    # result.json is somehow missing. Treat that as done; otherwise the job was
    # mid-flight when we lost it -> report it as still running (caller re-polls).
    telem = d / "telemetry.json"
    summary = d / "summary.html"
    if telem.is_file() and summary.is_file():
        artifacts = {
            k: v.name
            for k, v in {
                "telemetry": telem,
                "summary": summary,
                "video": d / "run.mp4",
                "scene": d / "scene.xml",
            }.items()
            if v.is_file()
        }
        try:
            tele = json.loads(telem.read_text())
        except Exception:
            tele = {}
        return Job(
            id=job_id,
            status="done",
            created_at=record.get("created_at") or os.path.getmtime(d),
            finished_at=record.get("finished_at") or os.path.getmtime(summary),
            result={
                "status": "ok",
                "supported": True,
                "success": bool(tele.get("reached")),
                "telemetry": tele,
                "artifacts": artifacts,
                "reconstructed": True,
            },
        )

    if record.get("status") in ("queued", "running"):
        # Lost mid-flight after a restart: the worker that owned it is gone, so
        # it will never finish. Report error honestly rather than hang forever.
        return Job(
            id=job_id,
            status="error",
            created_at=record.get("created_at") or os.path.getmtime(d),
            finished_at=time.time(),
            error="worker restarted before this job finished (no artifacts on disk)",
        )

    return None


def create_job() -> Job:
    job = Job(id=uuid.uuid4().hex[:12])
    with _LOCK:
        _JOBS[job.id] = job
    _persist(job)
    return job


def get_job(job_id: str) -> Optional[Job]:
    with _LOCK:
        job = _JOBS.get(job_id)
    if job is not None:
        return job
    # In-process miss (e.g. after a restart): reconstruct from disk artifacts.
    recovered = _reconstruct_from_disk(job_id)
    if recovered is not None:
        with _LOCK:
            # Cache it so subsequent polls are cheap; don't clobber a live entry.
            _JOBS.setdefault(recovered.id, recovered)
            return _JOBS[recovered.id]
    return None


def _execute(
    job: Job,
    assembly: Assembly,
    options: SimulateOptions,
    build_plan: Optional[BuildPlanIR],
    media: List[ComponentMedia],
) -> None:
    with _LOCK:
        job.status = "running"
    _persist(job)
    try:
        result = run_pipeline(assembly, options, job_dir(job.id), build_plan, media)
        with _LOCK:
            job.result = result
            job.status = "done"
            job.finished_at = time.time()
        _persist(job)
    except Exception as e:  # pragma: no cover - surfaced via job.error
        with _LOCK:
            job.error = f"{e}\n{traceback.format_exc()}"
            job.status = "error"
            job.finished_at = time.time()
        _persist(job)


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
