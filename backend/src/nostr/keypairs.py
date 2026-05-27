import json
from pathlib import Path

from nostr_sdk import Keys

_DATA_FILE = Path(__file__).parent.parent.parent / "data" / "keypairs.json"
_keys: Keys | None = None


def _load() -> str | None:
    if _DATA_FILE.exists():
        data = json.loads(_DATA_FILE.read_text())
        return data.get("secret_key")
    return None


def _save(secret_key: str) -> None:
    _DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    _DATA_FILE.write_text(json.dumps({"secret_key": secret_key}, indent=2))


def get_keys() -> Keys:
    global _keys
    if _keys is not None:
        return _keys

    raw = _load()
    if raw:
        _keys = Keys.parse(raw)
    else:
        _keys = Keys.generate()
        _save(_keys.secret_key().to_bech32())

    return _keys
