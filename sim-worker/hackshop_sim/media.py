"""Best-effort component image fetch for the summary page.

The web app owns the device->image map (`site/lib/image-sources.ts`) and forwards
resolved upstream URLs in the simulate request. We download them here, server-
side (no browser referer to trip anti-hotlink), and write them next to the other
artifacts so summary.html is fully self-contained and shareable. Every fetch is
best-effort: a failure just means that card falls back to a coloured placeholder.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Dict, List
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from .ir import ComponentMedia

_UA = "Mozilla/5.0 (compatible; HackShopSimWorker/1.0; +https://hackshop.dev)"
_MAX_BYTES = 4 * 1024 * 1024  # 4 MB cap per image
_TIMEOUT_S = 6.0
_OK_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif"}


def _ext_for(url: str) -> str:
    path = urlparse(url).path
    ext = os.path.splitext(path)[1].lower()
    return ext if ext in _OK_EXT else ".jpg"


def download_component_images(media: List[ComponentMedia], run_dir: Path) -> Dict[str, str]:
    """Fetch each component image into run_dir. Returns {ref: filename}."""
    out: Dict[str, str] = {}
    for m in media:
        if not m.image_url:
            continue
        fname = f"comp_{m.ref}{_ext_for(m.image_url)}"
        try:
            req = Request(m.image_url, headers={"User-Agent": _UA})
            with urlopen(req, timeout=_TIMEOUT_S) as resp:  # noqa: S310 (trusted app-supplied URL)
                data = resp.read(_MAX_BYTES + 1)
            if not data or len(data) > _MAX_BYTES:
                continue
            (run_dir / fname).write_bytes(data)
            out[m.ref] = fname
        except Exception as e:  # pragma: no cover - network best-effort
            print(f"[media] fetch failed for {m.ref} ({m.image_url}): {e}")
    return out
