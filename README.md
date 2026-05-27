# FLARE — Facebook Liberation And Relay of Events

A decentralized, open city events platform that bridges Facebook event data to the Nostr protocol. Volunteers install a browser extension that passively captures Facebook events, signs them with their own Nostr keypair, and publishes them directly to any Nostr relay they choose.

---

## Extension

```bash
cd extension
npm install
npm run build    # one-shot
npm run dev      # watch mode
```

### Load extension in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `extension/` directory

---

## Relay (Docker)

```bash
chmod +x scripts/relay_policy.py
docker compose up -d
```

The relay binds to `127.0.0.1:8080`. Reverse-proxy to expose it over TLS (`wss://`).

The write policy plugin (`scripts/relay_policy.py`) runs as a long-lived subprocess inside the container. It queries `GET /api/trust/whitelist` at startup and caches the result for 5 minutes. No cron job or config reload is needed — whitelist changes take effect within the next cache TTL window.

---

## Backend (trust registry)
Do note, that the backend is purely for our relay (relay.informatyczny.org). You can re-use our mechanism if you choose to do so, however if you're only interested in the extension, this section is not important.

```bash
cd backend
uv sync
uv run uvicorn src.main:app --reload --app-dir backend   # port 8000
```

### Seed the first volunteer (bypasses invite requirement)

```bash
uv run python -m src.volunteers.trust seed --pubkey <hex>
```

### API

The API docs are generated automatically and can be viewed at /docs.

### Configuration

```bash
cp backend/.env.example backend/.env
```
And change the configuration as needed.

---

## Development checks

```bash
# Backend
cd backend
uv run ruff check --fix
uv run ty check

# Extension
cd extension
npx tsc --noEmit
npm run build
```
Please run the respective one before submitting a pull request.