# FLARE — Facebook Liberation And Relay of Events

A decentralized, open city events platform that bridges Facebook event data to the Nostr protocol. Volunteers install a browser extension that passively captures Facebook events, signs them with their own Nostr keypair, and publishes them directly to any Nostr relay they choose.

---

## Setup

```bash
npm install
npm run build    # one-shot
npm run dev      # watch mode
```

### Load extension in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select this directory
