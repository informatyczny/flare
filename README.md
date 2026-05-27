# FLARE — Facebook Liberation And Relay of Events

A tool for bridging Facebook's walled-garden event data to the open [Nostr](https://nostr.com) protocol. Volunteers install a browser extension that passively captures events as they browse Facebook. The backend normalizes each event, verifies it through a community trust system, and publishes approved events as [NIP-52](https://github.com/nostr-protocol/nips/blob/master/52.md) calendar events to public Nostr relays, where any Nostr client can read it.

---

## Architecture

```
[Browser Extension]
    ├── generates keypair on first install
    ├── intercepts Facebook XHR/fetch responses
    └── signs & POST /api/events
                └── [Backend API]
                        ├── verify signature
                        ├── check volunteer trust status
                        ├── run consensus gate
                        └── publish to Nostr or queue for review
                                        ↑
                            [Admin Panel (SvelteKit)]
                                ├── login with Nostr extension (NIP-98)
                                ├── review & approve/reject queue
                                └── manage volunteer trust levels
```

---

## Prerequisites

| Tool | Purpose |
|------|---------|
| [uv](https://github.com/astral-sh/uv) | Python package manager (backend) |
| Python 3.12+ | Backend runtime |
| Node.js 18+ / npm | Extension and frontend build |
| Chrome or Chromium | Loading the unpacked extension |
| SQLite 3 | Database (included with Python) |
| A [NIP-07](https://github.com/nostr-protocol/nips/blob/master/07.md) browser extension | Admin panel login (e.g. [Alby](https://getalby.com), [nos2x](https://github.com/fiatjaf/nos2x)) |

---

## Backend

### Setup

```bash
cd backend
cp .env.example .env   # edit relays, consensus threshold, database path
uv sync
```

### Running

```bash
cd backend
uv run uvicorn src.main:app --reload --app-dir .
```

The API is available at `http://localhost:8000`. The database schema is created automatically on first run.

### Configuration

Edit `backend/.env`:

```env
# Nostr relay WebSocket URLs (JSON list)
NOSTR_RELAYS=["wss://relay.damus.io","wss://nos.lol","wss://relay.nostr.band"]

# Number of distinct trusted volunteers needed to auto-approve an event
CONSENSUS_THRESHOLD=2

# SQLite database path
DATABASE_URL=sqlite:///./data/flare.db
```

### Bootstrapping

The system needs at least one trusted volunteer to issue invite tokens, and at least one admin pubkey to access the admin panel. Run these once after the first `uv sync`:

```bash
cd backend

# 1. Create the first trusted volunteer (hex or npub accepted)
uv run python src/volunteers/seed.py add --pubkey <hex_or_npub> --nickname "Alice"

# 2. Register an admin pubkey (the Nostr key you'll log into the admin panel with)
uv run python src/admin/seed.py add --pubkey <hex_or_npub>

# 3. (Optional) List registered volunteers / admins
uv run python src/volunteers/seed.py list
uv run python src/admin/seed.py list
```

### Local relay for testing

```bash
docker run -d -p 8080:8080 scsibug/nostr-rs-relay
```

Set `.env` to point at it:

```env
NOSTR_RELAYS=["ws://localhost:8080"]
```

Query stored events:

```bash
echo '["REQ","sub1",{"kinds":[31923]}]' | nostcat ws://localhost:8080
```

### Keypair

A global signing keypair is generated on first run and persisted to `backend/data/keypairs.json` (gitignored). Back it up if you want a stable Nostr pubkey across deployments.

### Database

Data is stored in SQLite at `backend/data/flare.db` (gitignored):

- `volunteers` — pubkey, nickname, status (probation/trusted/banned), approval count
- `invite_tokens` — single-use tokens issued by trusted volunteers
- `queued_events` — events pending review or consensus
- `published_events` — log of published events
- `admins` — pubkeys allowed to access the admin panel

### Logs

Written to `backend/logs/api.log` (rotating, 5 MB cap, 3 backups) and stdout at INFO level.

### Endpoints

#### Volunteer Management

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/volunteers/register` | — | Register with an invite token |
| `POST` | `/api/volunteers/invite` | Volunteer signature | Generate an invite token (trusted only) |
| `GET` | `/api/volunteers/status?pubkey=` | — | Look up a volunteer's status |

#### Event Submission

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/events` | Volunteer signature | Submit a scraped event |
| `GET` | `/api/health` | — | API health and configured relays |

#### Admin

All admin endpoints (except `/api/admin/check`) require a [NIP-98](https://github.com/nostr-protocol/nips/blob/master/98.md) `Authorization: Nostr <base64>` header signed by a registered admin pubkey.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/check?pubkey=` | Check if a pubkey is an admin (public) |
| `GET` | `/api/admin/queue` | List events pending review |
| `POST` | `/api/admin/queue/{facebook_id}/approve` | Approve and publish a queued event |
| `POST` | `/api/admin/queue/{facebook_id}/reject` | Reject a queued event |
| `GET` | `/api/admin/volunteers` | List all volunteers with invite chain info |
| `POST` | `/api/admin/volunteers/{pubkey}/status` | Update a volunteer's trust level |

---

## Volunteer Trust System

### Statuses

- **probation** — newly registered; all submissions queued for manual review; no consensus counting
- **trusted** — promoted after 3 manual approvals; submissions count toward consensus; can issue invite tokens
- **banned** — all submissions silently rejected

### Approval flow

1. New volunteer's events go to the admin queue (no consensus counting).
2. Moderator approves via the admin panel. On the 3rd approval the volunteer is automatically promoted to `trusted`.
3. Trusted volunteer submits an event → increment consensus counter. If counter ≥ `CONSENSUS_THRESHOLD`, auto-approve and publish immediately.
4. Below threshold: queue and keep watching. If a second trusted volunteer submits the same event, auto-approve without moderator action.

Each volunteer can only contribute once per event to the consensus count — multiple submissions of the same event from the same key do not inflate the count.

### Invite tokens

- Issued by trusted volunteers via `POST /api/volunteers/invite`
- Single-use; consumed on registration
- Max 3 outstanding tokens per volunteer

### Signature scheme

Every event submission must carry a Schnorr signature over the canonical JSON of the payload (all fields except `signature`, keys sorted alphabetically, `null`/`undefined` values omitted). The `volunteer_pubkey` field is included in the signed payload.

---

## Admin Panel (Frontend)

A SvelteKit web app for moderating the event queue and managing volunteers.

### Setup

```bash
cd frontend
npm install
```

### Running

```bash
cd frontend
npm run dev    # dev server at http://localhost:5173
```

For production:

```bash
npm run build
npm run preview
```

### Configuration

Create `frontend/.env` (or set at build time):

```env
PUBLIC_API_BASE=http://localhost:8000
```

### Authentication

Login uses [NIP-98 HTTP Auth](https://github.com/nostr-protocol/nips/blob/master/98.md) — no passwords or tokens. The admin panel uses your Nostr browser extension (Alby, nos2x, etc.) to sign each authenticated request. Only pubkeys registered via `src/admin/seed.py add` are granted access.

### Features

- **Event Queue** — review pending events, approve (publishes to Nostr) or reject
- **Volunteers** — see all registered volunteers, their trust level, who invited them, and how many people they've invited; promote/demote/ban directly from the panel

---

## Browser Extension

### Setup

```bash
cd extension
npm install
npm run build    # compiles TypeScript to extension/dist/
npm run dev      # watch mode
```

### Loading in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (toggle top-right)
3. Click **Load unpacked** → select the `extension/` folder (not `extension/dist/`)

### How it works

- Generates a Nostr keypair on first install and stores it in `chrome.storage.local`
- Activates on any `facebook.com/events/*` URL
- Intercepts internal GraphQL responses to extract event data (no auth bypass — the user is already logged in to Facebook)
- Buffers and deduplicates candidates per event ID, selects the richest data node, then signs and POSTs to the backend
- Popup shows registration status, volunteer info, and the last captured event

### Registration flow

1. Open the extension popup
2. Enter an invite token from a trusted volunteer
3. Choose a nickname
4. Click **Register**

### Using an existing key on a second browser

1. On your first browser: open the popup → click **Copy private key (nsec)**
2. On the second browser: open the popup → expand **Already have a key?** → paste the nsec and click **Import Key**

### Configuring the backend URL

The extension defaults to `http://localhost:8000`. Change it in the popup under **Settings → Backend URL**.

---

## End-to-end flow

1. Start the backend and (optionally) a local Nostr relay
2. Bootstrap: seed the first trusted volunteer and admin pubkey
3. Load the unpacked extension in Chrome and register it
4. Log in to Facebook and browse to any public event page
5. The extension captures the event automatically, signs it, and POSTs to the backend
6. The backend validates the signature and routes the event:
   - **Probation volunteer** → manual review queue
   - **Trusted + consensus reached** → published immediately to Nostr relays
   - **Trusted + below threshold** → queued, auto-publishes if consensus is reached later
7. Moderator can review the queue and manage volunteers via the admin panel
8. Published events appear in any NIP-52-compatible Nostr client (e.g. [Coracle](https://coracle.social), [Amethyst](https://github.com/vitorpamplona/amethyst), [Flockstr](https://www.flockstr.com))

---

## Development

```bash
# Backend linting / type checking
cd backend
uv run ruff check .
uv run ruff format .
uv run ty check
```

Gitignored paths: `backend/data/`, `backend/.env`, `backend/logs/`, `extension/dist/`, `frontend/.env`
