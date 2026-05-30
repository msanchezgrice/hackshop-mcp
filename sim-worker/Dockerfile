# HackShop sim-worker: MuJoCo physics + offscreen render behind FastAPI.
#
# Offscreen rendering on a headless VM (no GPU) uses MuJoCo's OSMesa software
# backend — set MUJOCO_GL=osmesa and ship libosmesa6. EGL needs a real GPU; on
# Fly/Render shared CPU it isn't available, so OSMesa is the reliable choice.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    MUJOCO_GL=osmesa \
    PYOPENGL_PLATFORM=osmesa

# System libs: OSMesa (software GL) for MuJoCo offscreen, GL/GLU loaders, and
# ffmpeg for the mp4 mux (imageio[ffmpeg] bundles a binary, but the system one
# avoids the first-run download and is smaller overall).
RUN apt-get update && apt-get install -y --no-install-recommends \
      libosmesa6 \
      libgl1 \
      libglu1-mesa \
      libglew2.2 \
      ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first (better layer caching), then the package itself.
COPY pyproject.toml ./
RUN pip install --upgrade pip && pip install ".[agent]" || true
COPY . .
RUN pip install ".[agent]"

# Artifacts are written here and served at /artifacts. Ephemeral by design —
# each run regenerates its own folder; no volume required for the demo.
ENV HACKSHOP_RUNS_DIR=/app/runs
EXPOSE 8000

# 1 worker: MuJoCo rollouts are CPU-bound and the in-process job table isn't
# shared across workers. Scale with more machines, not more workers.
CMD ["uvicorn", "hackshop_sim.server:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
