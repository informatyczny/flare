import time

_seen: dict[str, float] = {}
_TTL = 86400  # 24 hours


def is_duplicate(facebook_id: str) -> bool:
    now = time.time()
    if facebook_id in _seen:
        if now - _seen[facebook_id] < _TTL:
            return True
        del _seen[facebook_id]
    _seen[facebook_id] = now
    return False
