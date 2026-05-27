from __future__ import annotations

import sys
from pathlib import Path

_src = str(Path(__file__).parent.parent)
if _src not in sys.path:
    sys.path.insert(0, _src)

from .router import router

__all__ = ["router"]
