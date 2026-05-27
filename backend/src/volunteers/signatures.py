import hashlib
import json
import logging

import secp256k1

_log = logging.getLogger(__name__)


def verify_signature(payload: dict, signature_hex: str, pubkey_hex: str) -> bool:
    try:
        payload_copy = {
            k: v for k, v in payload.items() if k != "signature" and v is not None
        }
        # ensure_ascii=False keeps Unicode chars as-is, matching JS JSON.stringify behavior.
        canonical = json.dumps(
            payload_copy, sort_keys=True, separators=(",", ":"), ensure_ascii=False
        )
        msg_hash = hashlib.sha256(canonical.encode("utf-8")).digest()

        # Nostr pubkeys are 32-byte x-only; prefix with 0x02 for compressed form
        pubkey_bytes = bytes.fromhex(pubkey_hex)
        pk = secp256k1.PublicKey(b"\x02" + pubkey_bytes, raw=True)

        sig_bytes = bytes.fromhex(signature_hex)
        ok = pk.schnorr_verify(msg_hash, sig_bytes, bip340tag=None, raw=True)
        if not ok:
            _log.debug("Signature mismatch — canonical: %s", canonical)
        return ok
    except Exception as exc:
        _log.debug("Signature verification error: %s", exc)
        return False


def canonical_json(obj: dict) -> str:
    """Return canonical JSON representation (sorted keys, compact, Unicode preserved)."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
