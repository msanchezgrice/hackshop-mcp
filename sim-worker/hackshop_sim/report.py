"""Self-contained HTML summary for a simulation run.

One shareable page that walks product -> components -> high-fidelity renders ->
wiring schematic -> assembly -> build plan -> dimensions -> simulation -> verdict.
All media are referenced by relative filename so the page works straight from the
artifacts directory (or copied anywhere alongside the files). No external assets,
no JS framework — just inline CSS + one inline SVG.
"""

from __future__ import annotations

import html
from typing import Dict, List, Optional

from .assets.resolve import RobotSpec
from .ir import Assembly, BuildPlanIR
from .scene.compile import SceneBuild

_ROLE_COLOR = {
    "chassis": "#3490f0",
    "compute": "#8b8f99",
    "sensor": "#19cdd6",
    "power": "#34c759",
    "display": "#e8eaf0",
    "actuator": "#e69e2e",
    "peripheral": "#b88ef2",
}

_ACTION_COLOR = {
    "solder": "#e69e2e",
    "flash": "#3490f0",
    "glue": "#b88ef2",
    "connect": "#19cdd6",
    "crimp": "#e69e2e",
    "mount": "#8b8f99",
    "print_3d": "#34c759",
    "calibrate": "#e8b34a",
    "test": "#34c759",
}

_RENDER_LABELS = {
    "hero": "Hero",
    "iso": "Isometric",
    "front": "Front",
    "side": "Side",
    "top": "Top-down",
}


def _esc(s: object) -> str:
    return html.escape(str(s))


def _telem_num(t: dict, k: str) -> Optional[float]:
    v = t.get(k)
    return float(v) if isinstance(v, (int, float)) else None


def _component_carousel(
    assembly: Assembly, component_images: Dict[str, str]
) -> str:
    cards = ""
    for c in assembly.components:
        color = _ROLE_COLOR.get(c.role, "#8b8f99")
        img = component_images.get(c.ref)
        if img:
            media = f'<img src="{_esc(img)}" alt="{_esc(c.name)}" loading="lazy"/>'
        else:
            # Coloured placeholder when no upstream photo resolved.
            media = (
                f'<div class="ph" style="background:'
                f'linear-gradient(135deg,{color}22,{color}0a)">'
                f'<span class="ph-dot" style="background:{color}"></span>'
                f'<span class="ph-id">{_esc(c.device_id)}</span></div>'
            )
        cards += (
            '<figure class="card">'
            f'<div class="card-media">{media}</div>'
            '<figcaption>'
            f'<div class="card-name">{_esc(c.name)}</div>'
            f'<div class="card-role"><span class="dot" style="background:{color}"></span>'
            f'{_esc(c.role)}</div>'
            f'<div class="mono">{_esc(c.device_id)}</div>'
            '</figcaption></figure>'
        )
    return f'<div class="carousel">{cards}</div>'


def _render_gallery(studio_renders: Dict[str, str]) -> str:
    if not studio_renders:
        return ""
    order = ["hero", "iso", "front", "side", "top"]
    cells = ""
    for cam in order:
        fname = studio_renders.get(cam)
        if not fname:
            continue
        featured = " featured" if cam == "hero" else ""
        cells += (
            f'<figure class="shot{featured}">'
            f'<img src="{_esc(fname)}" alt="{_esc(_RENDER_LABELS.get(cam, cam))} render" loading="lazy"/>'
            f'<figcaption>{_esc(_RENDER_LABELS.get(cam, cam))}</figcaption>'
            '</figure>'
        )
    return (
        '<section>'
        '<h2>High-fidelity render</h2>'
        '<p class="muted" style="margin:-6px 0 14px;font-size:12.5px">'
        'Studio shots of the assembled buildout — same proxy geometry as the sim, '
        'lit and shot on a clean stage.</p>'
        f'<div class="gallery">{cells}</div>'
        '</section>'
    )


def _build_plan_section(assembly: Assembly, build_plan: Optional[BuildPlanIR]) -> str:
    if build_plan is None or not build_plan.steps:
        return ""
    name_by_id = {c.device_id: c.name for c in assembly.components}
    rows = ""
    for s in build_plan.steps:
        color = _ACTION_COLOR.get(s.action, "#8b8f99")
        parts = ", ".join(name_by_id.get(p, p) for p in s.parts)
        meta_bits = []
        if parts:
            meta_bits.append(f'<span class="bp-meta">parts: {_esc(parts)}</span>')
        if s.tools:
            meta_bits.append(f'<span class="bp-meta">tools: {_esc(", ".join(s.tools))}</span>')
        if s.est_minutes:
            meta_bits.append(f'<span class="bp-meta">~{int(s.est_minutes)} min</span>')
        meta = " ".join(meta_bits)
        risk = (
            f'<div class="bp-risk">⚠ {_esc(s.risk_note)}</div>' if s.risk_note else ""
        )
        rows += (
            '<li class="bp-step">'
            f'<div class="bp-num">{int(s.order)}</div>'
            '<div class="bp-body">'
            f'<span class="bp-action" style="background:{color}1f;color:{color};'
            f'border-color:{color}55">{_esc(s.action)}</span> '
            f'<span class="bp-detail">{_esc(s.detail)}</span>'
            f'<div class="bp-metas">{meta}</div>{risk}'
            '</div></li>'
        )
    total = build_plan.total_minutes
    total_label = (
        f'<span class="muted" style="font-weight:400"> · ~{total // 60}h {total % 60}m total</span>'
        if total >= 60
        else (f'<span class="muted" style="font-weight:400"> · ~{total} min total</span>' if total else "")
    )
    return (
        '<section>'
        f'<h2>Build plan · {len(build_plan.steps)} steps{total_label}</h2>'
        f'<ol class="bp">{rows}</ol>'
        '<p class="muted" style="font-size:11.5px;margin-top:6px">'
        'Assembly steps are planned + checked, never physically simulated.</p>'
        '</section>'
    )


def _schematic_section(schematic_svg: Optional[str]) -> str:
    if not schematic_svg:
        return ""
    return (
        '<section>'
        '<h2>Wiring schematic</h2>'
        f'<div class="schematic">{schematic_svg}</div>'
        '</section>'
    )


def build_summary_html(
    *,
    assembly: Assembly,
    robot: RobotSpec,
    scene: SceneBuild,
    success: bool,
    summary: str,
    post_mortem: str,
    authored_by: str,
    telemetry: dict,
    video_file: Optional[str],
    poster_file: Optional[str],
    scene_file: Optional[str],
    telemetry_file: Optional[str],
    build_plan: Optional[BuildPlanIR] = None,
    component_images: Optional[Dict[str, str]] = None,
    schematic_svg: Optional[str] = None,
    studio_renders: Optional[Dict[str, str]] = None,
) -> str:
    component_images = component_images or {}
    studio_renders = studio_renders or {}
    idea = _esc(assembly.idea)
    verdict = "Reached the goal" if success else "Did not reach the goal"
    verdict_color = "#34c759" if success else "#ef4444"

    # ── components ───────────────────────────────────────────────────────────
    comp_rows = ""
    for c in assembly.components:
        color = _ROLE_COLOR.get(c.role, "#8b8f99")
        comp_rows += (
            "<tr>"
            f'<td><span class="dot" style="background:{color}"></span>{_esc(c.name)}</td>'
            f'<td><span class="role">{_esc(c.role)}</span></td>'
            f"<td class=\"mono\">{_esc(c.device_id)}</td>"
            "</tr>"
        )

    # ── protocol edges ───────────────────────────────────────────────────────
    if assembly.edges:
        edge_items = "".join(
            f'<li><span class="mono">{_esc(e.from_)}</span> '
            f'<span class="arrow">→</span> <span class="mono">{_esc(e.to)}</span> '
            f'<span class="tag">{_esc(e.transport)}</span>'
            f'{(" " + _esc(e.payload)) if e.payload else ""}</li>'
            for e in assembly.edges
        )
        edges_html = f'<ul class="edges">{edge_items}</ul>'
    else:
        edges_html = '<p class="muted">No protocol links declared.</p>'

    # ── dimensions ───────────────────────────────────────────────────────────
    dims = [
        ("Base device", robot.device_id),
        ("Provenance", robot.provenance),
        ("Chassis Ø", f"{robot.chassis_radius_m * 2:.3f} m"),
        ("Chassis height", f"{robot.chassis_height_m:.3f} m"),
        ("Wheelbase", f"{robot.wheel_base_m:.3f} m"),
        ("Wheel radius", f"{robot.wheel_radius_m:.3f} m"),
        ("Base mass", f"{robot.mass_kg:.2f} kg"),
        ("Total mass (built)", f"{scene.total_mass_kg:.2f} kg"),
    ]
    dim_cells = "".join(
        f'<div class="dim"><div class="dim-k">{_esc(k)}</div>'
        f'<div class="dim-v">{_esc(v)}</div></div>'
        for k, v in dims
    )

    mount_rows = ""
    for m in scene.mounted:
        color = _ROLE_COLOR.get(m["role"], "#8b8f99")
        mount_rows += (
            "<tr>"
            f'<td><span class="dot" style="background:{color}"></span>{_esc(m["name"])}</td>'
            f'<td><span class="role">{_esc(m["role"])}</span></td>'
            f'<td class="mono">{_esc(m["mass_kg"])} kg</td>'
            "</tr>"
        )
    if not mount_rows:
        mount_rows = '<tr><td colspan="3" class="muted">Bare base — no parts mounted.</td></tr>'

    # ── 3D model + video ─────────────────────────────────────────────────────
    poster_html = (
        f'<img src="{_esc(poster_file)}" alt="3D model of the assembled robot"/>'
        if poster_file
        else '<div class="muted pad">No 3D snapshot rendered.</div>'
    )
    video_html = (
        f'<video src="{_esc(video_file)}" controls autoplay loop muted playsinline></video>'
        if video_file
        else '<div class="muted pad">No video rendered (telemetry only).</div>'
    )

    # ── telemetry highlights ─────────────────────────────────────────────────
    fd = _telem_num(telemetry, "final_dist")
    md = _telem_num(telemetry, "min_dist")
    col = _telem_num(telemetry, "collisions")
    osc = _telem_num(telemetry, "heading_osc_deg")
    dur = _telem_num(telemetry, "duration_s")
    stats = [
        ("Final distance", f"{fd:.2f} m" if fd is not None else "—"),
        ("Closest approach", f"{md:.2f} m" if md is not None else "—"),
        ("Collisions", f"{int(col)}" if col is not None else "—"),
        ("Heading wobble", f"±{osc / 2:.0f}°" if osc is not None else "—"),
        ("Rollout", f"{dur:.0f} s" if dur is not None else "—"),
    ]
    stat_cells = "".join(
        f'<div class="stat"><div class="stat-v">{_esc(v)}</div>'
        f'<div class="stat-k">{_esc(k)}</div></div>'
        for k, v in stats
    )

    badges = ""
    if telemetry.get("tipped"):
        badges += '<span class="badge warn">tipped over</span>'
    if telemetry.get("stuck"):
        badges += '<span class="badge warn">got stuck</span>'
    if col and col > 0:
        badges += f'<span class="badge warn">{int(col)} collisions</span>'
    if osc and osc > 25:
        badges += f'<span class="badge warn">heading wobble ±{osc / 2:.0f}°</span>'

    links = []
    if video_file:
        links.append(f'<a href="{_esc(video_file)}">video</a>')
    if scene_file:
        links.append(f'<a href="{_esc(scene_file)}">scene.xml</a>')
    if telemetry_file:
        links.append(f'<a href="{_esc(telemetry_file)}">telemetry.json</a>')
    links_html = " · ".join(links)

    # ── composed optional sections ───────────────────────────────────────────
    components_section = (
        '<section>'
        f'<h2>Components · {len(assembly.components)}</h2>'
        f'{_component_carousel(assembly, component_images)}'
        '</section>'
    )
    render_section = _render_gallery(studio_renders)
    schematic_section = _schematic_section(schematic_svg)
    build_plan_section = _build_plan_section(assembly, build_plan)

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>HackShop · {idea}</title>
<style>
  :root {{
    --bg:#0c0e12; --panel:#14171d; --border:#252a33; --fg:#e7eaf0;
    --muted:#8b909b; --accent:#3490f0;
  }}
  * {{ box-sizing:border-box; }}
  body {{
    margin:0; background:var(--bg); color:var(--fg);
    font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  }}
  .wrap {{ max-width:920px; margin:0 auto; padding:32px 20px 64px; }}
  header .kicker {{ color:var(--accent); font-size:12px; letter-spacing:.12em;
    text-transform:uppercase; font-weight:700; }}
  header h1 {{ font-size:26px; margin:6px 0 4px; line-height:1.25; }}
  .verdict {{ display:inline-block; margin-top:10px; padding:6px 12px; border-radius:999px;
    font-weight:700; font-size:13px; }}
  section {{ background:var(--panel); border:1px solid var(--border); border-radius:12px;
    padding:18px 20px; margin-top:18px; }}
  section h2 {{ font-size:12px; letter-spacing:.1em; text-transform:uppercase;
    color:var(--muted); margin:0 0 14px; font-weight:700; }}
  table {{ width:100%; border-collapse:collapse; }}
  td {{ padding:7px 8px; border-bottom:1px solid var(--border); font-size:14px; }}
  tr:last-child td {{ border-bottom:0; }}
  .dot {{ display:inline-block; width:9px; height:9px; border-radius:3px; margin-right:9px;
    vertical-align:middle; }}
  .role {{ font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.05em; }}
  .mono {{ font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12.5px;
    color:var(--muted); }}
  .muted {{ color:var(--muted); }}
  .pad {{ padding:24px; text-align:center; }}
  .edges {{ list-style:none; margin:0; padding:0; }}
  .edges li {{ padding:6px 0; border-bottom:1px solid var(--border); font-size:13.5px; }}
  .edges li:last-child {{ border-bottom:0; }}
  .arrow {{ color:var(--accent); }}
  .tag {{ display:inline-block; background:#1d222b; border:1px solid var(--border);
    border-radius:5px; padding:1px 7px; font-size:11px; color:var(--fg); margin:0 4px; }}
  /* component carousel */
  .carousel {{ display:flex; gap:12px; overflow-x:auto; padding-bottom:10px;
    scroll-snap-type:x mandatory; -webkit-overflow-scrolling:touch; }}
  .carousel .card {{ flex:0 0 auto; width:200px; margin:0; scroll-snap-align:start;
    background:#0f1217; border:1px solid var(--border); border-radius:10px; overflow:hidden; }}
  .card-media {{ height:150px; background:#0a0c10; display:flex; align-items:center;
    justify-content:center; }}
  .card-media img {{ width:100%; height:100%; object-fit:contain; }}
  .ph {{ width:100%; height:100%; display:flex; flex-direction:column; gap:8px;
    align-items:center; justify-content:center; }}
  .ph-dot {{ width:26px; height:26px; border-radius:8px; }}
  .ph-id {{ font-family:ui-monospace,Menlo,monospace; font-size:11px; color:var(--muted); }}
  .card figcaption {{ padding:10px 12px; }}
  .card-name {{ font-size:13.5px; font-weight:600; line-height:1.3; }}
  .card-role {{ font-size:11px; color:var(--muted); text-transform:uppercase;
    letter-spacing:.05em; margin:4px 0 6px; }}
  /* render gallery */
  .gallery {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:12px; }}
  .shot {{ margin:0; background:#0a0c10; border:1px solid var(--border); border-radius:10px;
    overflow:hidden; }}
  .shot.featured {{ grid-column:1 / -1; }}
  .shot img {{ width:100%; display:block; }}
  .shot figcaption {{ font-size:11px; color:var(--muted); text-transform:uppercase;
    letter-spacing:.06em; padding:7px 10px; border-top:1px solid var(--border); }}
  /* schematic */
  .schematic {{ width:100%; overflow-x:auto; }}
  .schematic svg {{ display:block; min-width:520px; }}
  /* build plan */
  .bp {{ list-style:none; margin:0; padding:0; counter-reset:step; }}
  .bp-step {{ display:flex; gap:12px; padding:12px 0; border-bottom:1px solid var(--border); }}
  .bp-step:last-child {{ border-bottom:0; }}
  .bp-num {{ flex:0 0 26px; width:26px; height:26px; border-radius:999px; background:#1d222b;
    border:1px solid var(--border); color:var(--fg); font-size:12px; font-weight:700;
    display:flex; align-items:center; justify-content:center; }}
  .bp-body {{ flex:1; min-width:0; }}
  .bp-action {{ display:inline-block; font-size:11px; font-weight:700; padding:2px 8px;
    border-radius:5px; border:1px solid; text-transform:uppercase; letter-spacing:.04em; }}
  .bp-detail {{ font-size:14px; }}
  .bp-metas {{ margin-top:5px; display:flex; flex-wrap:wrap; gap:6px 12px; }}
  .bp-meta {{ font-size:11.5px; color:var(--muted); }}
  .bp-risk {{ margin-top:6px; font-size:12px; color:#f8b36b; }}
  /* dims/media/stats */
  .dims {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px;
    margin-bottom:16px; }}
  .dim {{ background:#0f1217; border:1px solid var(--border); border-radius:8px; padding:10px 12px; }}
  .dim-k {{ font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; }}
  .dim-v {{ font-size:16px; font-weight:600; margin-top:3px; }}
  .media {{ display:grid; grid-template-columns:1fr 1fr; gap:16px; }}
  .media .label {{ font-size:11px; color:var(--muted); text-transform:uppercase;
    letter-spacing:.08em; margin-bottom:8px; }}
  .media img, .media video {{ width:100%; border-radius:8px; border:1px solid var(--border);
    background:#000; display:block; }}
  @media (max-width:680px) {{ .media {{ grid-template-columns:1fr; }} }}
  .stats {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(110px,1fr)); gap:10px; }}
  .stat {{ background:#0f1217; border:1px solid var(--border); border-radius:8px;
    padding:12px; text-align:center; }}
  .stat-v {{ font-size:20px; font-weight:700; }}
  .stat-k {{ font-size:11px; color:var(--muted); margin-top:2px; }}
  .badges {{ margin-top:14px; display:flex; gap:6px; flex-wrap:wrap; }}
  .badge {{ font-size:12px; padding:3px 9px; border-radius:999px; }}
  .badge.warn {{ background:rgba(239,68,68,.14); color:#f87171;
    border:1px solid rgba(239,68,68,.35); }}
  .post {{ margin-top:14px; font-size:14px; line-height:1.6; }}
  .links {{ margin-top:14px; font-size:12.5px; }}
  .links a {{ color:var(--accent); text-decoration:none; }}
  footer {{ color:var(--muted); font-size:11.5px; margin-top:24px; text-align:center; }}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="kicker">HackShop · build &amp; simulation summary</div>
    <h1>{idea}</h1>
    <span class="verdict" style="background:{verdict_color}22;color:{verdict_color}">{_esc(verdict)}</span>
  </header>

  {components_section}

  {render_section}

  {schematic_section}

  <section>
    <h2>Assembly graph</h2>
    <table>{comp_rows}</table>
    <h2 style="margin-top:18px">Protocol links</h2>
    {edges_html}
    <h2 style="margin-top:18px">Goal</h2>
    <p style="margin:0">{_esc(assembly.goal.spec)}<br/>
      <span class="muted">Success: {_esc(assembly.goal.success_metric)} · world: {_esc(assembly.world.template)}</span></p>
  </section>

  {build_plan_section}

  <section>
    <h2>Robot dimensions &amp; mass</h2>
    <div class="dims">{dim_cells}</div>
    <h2>Mounted parts</h2>
    <table>{mount_rows}</table>
  </section>

  <section>
    <h2>In-sim 3D model &amp; rollout video</h2>
    <div class="media">
      <div><div class="label">3D model (in-sim snapshot)</div>{poster_html}</div>
      <div><div class="label">Simulation video</div>{video_html}</div>
    </div>
  </section>

  <section>
    <h2>Result · authored by {_esc(authored_by)}</h2>
    <div class="stats">{stat_cells}</div>
    <div class="badges">{badges}</div>
    <div class="post">{_esc(post_mortem or summary)}</div>
    <div class="links">{links_html}</div>
  </section>

  <footer>Generated by the HackShop physics worker (MuJoCo). Proxy dynamics — primitive shapes with real mass / geometry, not scanned CAD. Component photos are upstream references; build steps are planned, not simulated.</footer>
</div>
</body>
</html>
"""
