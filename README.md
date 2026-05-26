# FLARE — Facebook Liberation And Relay of Events

A tool for bridging Facebook's walled-garden event data to the open [Nostr](https://nostr.com) protocol. Volunteers install a browser extension that passively captures events as they browse Facebook. The backend normalizes each event and publishes it as a [NIP-52](https://github.com/nostr-protocol/nips/blob/master/52.md) calendar event to public Nostr relays, where any Nostr client can read it.

---

## Architecture

```
[Browser Extension]
    └── intercepts Facebook XHR/fetch responses
    └── POST /api/events
                └── [Backend API]
                        └── validate + deduplicate
                        └── sign with global keypair
                        └── publish to Nostr relays
```

---

## Prerequisites

| Tool | Purpose |
|------|---------|
| [uv](https://github.com/astral-sh/uv) | Python package manager (backend) |
| Python 3.12+ | Backend runtime |
| Node.js 18+ / npm | Extension build |
| Chrome or Chromium | Loading the unpacked extension |

---

## Backend

### Setup

```bash
cd backend
cp .env.example .env   # edit if you want different relays
uv sync
```

### Running

```bash
cd backend
uv run uvicorn src.main:app --reload --app-dir .
```

The API is available at `http://localhost:8000`.

### Configuration

Edit `backend/.env` (copied from `.env.example`):

```env
# Comma-separated list of Nostr relay WebSocket URLs
NOSTR_RELAYS=["wss://relay.damus.io","wss://nos.lol","wss://relay.nostr.band"]
```

Alternatively, set `NOSTR_RELAYS` as an environment variable at runtime.

### Local relay for testing

For testing, run a local relay instead of publishing to the public network:

```bash
docker run -d -p 8080:8080 scsibug/nostr-rs-relay
```

Then set your `.env` to point at it:

```env
NOSTR_RELAYS=["ws://localhost:8080"]
```

### Keypair

A single global keypair is generated automatically on first run and persisted to `backend/data/keypairs.json`. This file is gitignored — back it up if you want to maintain a stable public key across deployments.

### Logs

Application logs are written to `backend/logs/api.log` (rotating, 5 MB cap, 3 backups). The file is gitignored. Logs are also printed to stdout at INFO level and above.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/events` | Receive a scraped event, publish to Nostr |
| `GET` | `/api/health` | Returns configured relays and status |

#### POST /api/events — request body

```json
{
  "facebook_id": "123456789",
  "title": "Example Event",
  "start": 1700000000,
  "end": 1700003600,
  "description": "An event description.",
  "location": "Venue Name, Warsaw",
  "cover_url": "https://example.com/cover.jpg",
  "source_url": "https://www.facebook.com/events/123456789",
  "city": "Warsaw"
}
```

Required fields: `facebook_id`, `title`, `start`, `source_url`.

#### POST /api/events — responses

| Status | Body | Meaning |
|--------|------|---------|
| 200 | `{"status": "published", "nostr_id": "..."}` | Event signed and published |
| 200 | `{"status": "duplicate"}` | Same `facebook_id` seen within 24 hours |
| 422 | `{"detail": [...]}` | Validation failure; request body logged for debugging |

---

## Browser Extension

### Setup

```bash
cd extension
npm install
npm run build        # compiles TypeScript to extension/dist/
```

To rebuild automatically on file changes:

```bash
npm run dev
```

### Loading in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right)
3. Click **Load unpacked** and select the `extension/` directory (not `extension/dist/`)
4. The extension icon should appear in the toolbar

### How it works

- Activates on any `facebook.com/events/*` URL
- Intercepts the internal GraphQL responses Facebook sends to the browser (no auth bypass — the user is already logged in and seeing the data)
- Extracts event fields and POSTs them to the backend
- The popup shows the last captured event and its submission status

### Configuring the backend URL

The extension defaults to `http://localhost:8000`. To point it at a different backend, open the extension popup and update the backend URL there (stored in `chrome.storage.sync`).

---

## End-to-end flow

1. Start the backend (`uv run uvicorn ...`)
2. Load the unpacked extension in Chrome
3. Log in to Facebook and browse to any public event page (e.g. `facebook.com/events/123456789`)
4. The extension captures the event automatically and POSTs it to the backend
5. The backend publishes it to Nostr relays — it will appear in any NIP-52-compatible client such as [Coracle](https://coracle.social) or [Amethyst](https://github.com/vitorpamplona/amethyst)

---

## Development notes

- The backend uses [ruff](https://docs.astral.sh/ruff/) for linting/formatting and [ty](https://github.com/astral-sh/ty) for type checking:
  ```bash
  uv run ruff check .
  uv run ruff format .
  uv run ty check
  ```
- `backend/data/keypairs.json`, `backend/.env`, `backend/logs/`, and `extension/dist/` are all gitignored
