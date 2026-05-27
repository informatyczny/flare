from __future__ import annotations

import sys
from pathlib import Path

_src = str(Path(__file__).parent.parent)
if _src not in sys.path:
    sys.path.insert(0, _src)

# Router is imported explicitly in main.py to avoid circular imports:
# admin.auth imports volunteers.database, which would trigger this __init__,
# which would import volunteers.router, which imports admin.auth — circular.
