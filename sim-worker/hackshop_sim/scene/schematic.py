"""Self-contained wiring schematic (SVG) from the Assembly graph.

A hub-and-spoke layout: the first compute component (or the first component) sits
at the centre, the rest fan out on a ring. Protocol edges are drawn as labelled
links between node positions. Pure string output — no external assets — so it
embeds directly into summary.html and survives being copied anywhere.
"""

from __future__ import annotations

import html
import math
from typing import Dict, List, Tuple

from ..ir import Assembly

_ROLE_COLOR = {
    "chassis": "#3490f0",
    "compute": "#8b8f99",
    "sensor": "#19cdd6",
    "power": "#34c759",
    "display": "#e8eaf0",
    "actuator": "#e69e2e",
    "peripheral": "#b88ef2",
}

_W = 860
_NODE_W = 168
_NODE_H = 52


def _esc(s: object) -> str:
    return html.escape(str(s))


def _node_positions(refs: List[str], hub: str) -> Tuple[Dict[str, Tuple[float, float]], int]:
    """Center the hub; ring the rest. Returns (positions, svg_height)."""
    others = [r for r in refs if r != hub]
    n = len(others)
    if n == 0:
        height = 160
        return {hub: (_W / 2, height / 2)}, height

    # Ring radius scales a little with count so labels don't collide.
    rx = _W / 2 - _NODE_W / 2 - 20
    ry = 120 + max(0, n - 4) * 14
    height = int(2 * ry + _NODE_H + 80)
    cx, cy = _W / 2, height / 2

    pos: Dict[str, Tuple[float, float]] = {hub: (cx, cy)}
    # Start at the top, go clockwise.
    for i, r in enumerate(others):
        ang = -math.pi / 2 + (2 * math.pi * i / n)
        pos[r] = (cx + rx * math.cos(ang), cy + ry * math.sin(ang))
    return pos, height


def build_schematic_svg(assembly: Assembly) -> str:
    comps = list(assembly.components)
    by_ref = {c.ref: c for c in comps}
    refs = [c.ref for c in comps]

    hub = next((c.ref for c in comps if c.role == "compute"), refs[0])
    pos, height = _node_positions(refs, hub)

    # ── edges ────────────────────────────────────────────────────────────────
    edge_svg: List[str] = []
    for e in assembly.edges:
        if e.from_ not in pos or e.to not in pos:
            continue
        x1, y1 = pos[e.from_]
        x2, y2 = pos[e.to]
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        label = e.transport.upper()
        if e.payload:
            p = e.payload if len(e.payload) <= 16 else e.payload[:15] + "…"
            label += f" · {p}"
        lw = 8 + len(label) * 6.0
        edge_svg.append(
            f'<line x1="{x1:.0f}" y1="{y1:.0f}" x2="{x2:.0f}" y2="{y2:.0f}" '
            f'stroke="#39414e" stroke-width="2"/>'
        )
        edge_svg.append(
            f'<rect x="{mx - lw / 2:.0f}" y="{my - 11:.0f}" width="{lw:.0f}" height="22" '
            f'rx="5" fill="#0f1217" stroke="#2b313c"/>'
            f'<text x="{mx:.0f}" y="{my + 4:.0f}" text-anchor="middle" '
            f'font-size="11" fill="#aeb4bf" font-family="ui-monospace,Menlo,monospace">{_esc(label)}</text>'
        )

    # ── nodes ────────────────────────────────────────────────────────────────
    node_svg: List[str] = []
    for ref in refs:
        c = by_ref[ref]
        x, y = pos[ref]
        color = _ROLE_COLOR.get(c.role, "#8b8f99")
        nx, ny = x - _NODE_W / 2, y - _NODE_H / 2
        name = c.name if len(c.name) <= 22 else c.name[:21] + "…"
        node_svg.append(
            f'<g>'
            f'<rect x="{nx:.0f}" y="{ny:.0f}" width="{_NODE_W}" height="{_NODE_H}" rx="9" '
            f'fill="#171b22" stroke="{color}" stroke-width="1.5"/>'
            f'<circle cx="{nx + 15:.0f}" cy="{y:.0f}" r="5" fill="{color}"/>'
            f'<text x="{nx + 28:.0f}" y="{y - 3:.0f}" font-size="13" fill="#e7eaf0" '
            f'font-family="-apple-system,Segoe UI,sans-serif" font-weight="600">{_esc(name)}</text>'
            f'<text x="{nx + 28:.0f}" y="{y + 13:.0f}" font-size="10" fill="#8b909b" '
            f'font-family="-apple-system,Segoe UI,sans-serif" letter-spacing="0.04em">'
            f'{_esc(c.role.upper())}</text>'
            f'</g>'
        )

    body = "\n  ".join(edge_svg + node_svg)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {_W} {height}" '
        f'width="100%" role="img" aria-label="wiring schematic" '
        f'style="background:#0c0e12;border-radius:8px">\n  {body}\n</svg>'
    )
