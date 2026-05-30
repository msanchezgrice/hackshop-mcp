"""Pydantic mirror of the TypeScript Assembly IR (`site/lib/assembly.ts`).

Keep this in sync with the Zod source of truth. The web app builds an Assembly
(idea + devices -> components/edges/goal/world) and POSTs it here; we validate
it with these models before touching the physics engine.
"""

from __future__ import annotations

from typing import List, Literal, Optional, Tuple

from pydantic import BaseModel, Field

ComponentRole = Literal[
    "compute",
    "actuator",
    "sensor",
    "display",
    "power",
    "chassis",
    "peripheral",
]

Transport = Literal[
    "usb",
    "i2c",
    "spi",
    "gpio",
    "uart",
    "wifi",
    "ble",
    "ros2",
    "hdmi",
    "aux",
    "power",
]

GoalKind = Literal["navigate", "locomote", "manipulate", "sense-act", "display-loop"]

WorldTemplate = Literal[
    "empty-room",
    "obstacle-course",
    "ramp",
    "stairs",
    "outdoor-flat",
    "tabletop",
]


class SimHandle(BaseModel):
    model_uri: Optional[str] = None
    format: Optional[Literal["mjcf", "urdf", "proxy"]] = None
    dof: Optional[int] = None
    mass_kg: Optional[float] = None


class AssemblyComponent(BaseModel):
    ref: str
    device_id: str
    name: str
    role: ComponentRole
    sim: Optional[SimHandle] = None


class ProtocolEdge(BaseModel):
    from_: str = Field(alias="from")
    to: str
    transport: Transport
    payload: Optional[str] = None

    model_config = {"populate_by_name": True}


class AssemblyGoal(BaseModel):
    kind: GoalKind
    spec: str
    success_metric: str


class WorldSpec(BaseModel):
    template: WorldTemplate
    goal_xy: Optional[Tuple[float, float]] = None


class Assembly(BaseModel):
    idea: str
    components: List[AssemblyComponent]
    edges: List[ProtocolEdge] = Field(default_factory=list)
    goal: AssemblyGoal
    world: WorldSpec


# ── Simulation request/response envelope ─────────────────────────────────────


class SimulateOptions(BaseModel):
    mode: Literal["sync", "async"] = "async"
    # Wall-clock seconds of simulated behaviour to roll out.
    duration_s: float = 20.0
    seed: int = 0
    render: bool = True
    # Use the LLM builder-agent loop to author/refine control. Falls back to the
    # scripted controller when no API key is present or the agent errors.
    agent: bool = False
    agent_max_iters: int = 3
    # Bounded mode for the MCP tool: caps duration + disables the agent so the
    # call returns within request/response budget.
    bounded: bool = False


# ── Build plan + media (optional enrichment for the summary page) ─────────────
# These are NOT consumed by the physics engine — they're forwarded by the web
# app (which owns the catalog + build-plan generator) so the worker can render a
# richer, self-contained summary.html. All optional; absence degrades cleanly.


class BuildStepIR(BaseModel):
    order: int
    action: str
    parts: List[str] = Field(default_factory=list)
    tools: List[str] = Field(default_factory=list)
    detail: str
    est_minutes: int = 0
    risk_note: Optional[str] = None
    depends_on: List[int] = Field(default_factory=list)


class BuildPlanIR(BaseModel):
    steps: List[BuildStepIR] = Field(default_factory=list)
    total_minutes: int = 0


class ComponentMedia(BaseModel):
    ref: str
    image_url: str


class SimulateRequest(BaseModel):
    assembly: Assembly
    options: SimulateOptions = Field(default_factory=SimulateOptions)
    # Optional summary enrichment forwarded by the web app.
    build_plan: Optional[BuildPlanIR] = None
    media: List[ComponentMedia] = Field(default_factory=list)
