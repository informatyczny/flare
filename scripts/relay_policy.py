#!/usr/bin/env python3
# scripts/relay_policy.py

import json
import sys
import time
import urllib.request

WHITELIST_URL = "http://backend:8000/api/trust/whitelist"
CACHE_TTL = 300  # refresh every 5 minutes

_cache: set[str] = set()
_cache_at: float = 0


def get_whitelist() -> set[str]:
    global _cache, _cache_at
    if time.time() - _cache_at > CACHE_TTL:
        try:
            with urllib.request.urlopen(WHITELIST_URL, timeout=5) as r:
                _cache = set(json.load(r)["pubkeys"])
            _cache_at = time.time()
        except Exception:
            pass  # keep serving stale cache on transient API failures
    return _cache


for line in sys.stdin:
    req = json.loads(line)
    event = req.get("event", {})
    pubkey = event.get("pubkey", "")

    allowed = pubkey in get_whitelist()

    print(json.dumps({
        "id": event["id"],
        "action": "accept" if allowed else "reject",
        "msg": "" if allowed else "not a registered FLARE volunteer",
    }), flush=True)
