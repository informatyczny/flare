import type { EventPayload } from "./types";

type FbRaw = Record<string, unknown>;

// Ask the background service worker to inject the main-world patcher via
// chrome.scripting.executeScript({ world: "MAIN" }), which bypasses page CSP entirely.
// Returns the random channel name the patcher will use to fire events.
async function injectPageScript(): Promise<string> {
  const channel = Math.random().toString(36).slice(2);
  try {
    await chrome.runtime.sendMessage({ type: "INJECT_MAIN_WORLD", channel });
  } catch {
    // Context invalidated or background unavailable — events won't fire.
  }
  return channel;
}

// --- Payload builders ---

function extractText(obj: unknown): string | undefined {
  if (typeof obj === "string") return obj || undefined;
  if (obj && typeof obj === "object") {
    const o = obj as FbRaw;
    if (typeof o.text === "string") return o.text || undefined;
  }
  return undefined;
}

function extractLocation(raw: FbRaw): string | undefined {
  const place = raw.event_place as FbRaw | undefined;
  if (!place) return undefined;
  const name = typeof place.name === "string" ? place.name : "";
  const loc = place.location as FbRaw | undefined;
  const city = loc && typeof loc.city === "string" ? loc.city : "";
  return [name, city].filter(Boolean).join(", ") || undefined;
}

function extractCity(raw: FbRaw): string {
  const place = raw.event_place as FbRaw | undefined;
  const loc = place?.location as FbRaw | undefined;
  return typeof loc?.city === "string" ? loc.city : "";
}

function extractCoverUrl(raw: FbRaw): string | undefined {
  try {
    const uri = (
      ((raw.cover as FbRaw)?.photo as FbRaw)?.image as FbRaw
    )?.uri;
    return typeof uri === "string" ? uri : undefined;
  } catch {
    return undefined;
  }
}

function extractSourceUrl(raw: FbRaw): string {
  if (typeof raw.url === "string") return raw.url;
  return `https://www.facebook.com/events/${raw.id}/`;
}

function buildPayload(raw: FbRaw): EventPayload {
  const city = extractCity(raw) || undefined;
  return {
    facebook_id: String(raw.id),
    title: String(raw.name),
    start: Number(raw.start_timestamp),
    end: raw.end_timestamp ? Number(raw.end_timestamp) : undefined,
    description: extractText(raw.description),
    location: extractLocation(raw),
    cover_url: extractCoverUrl(raw),
    source_url: extractSourceUrl(raw),
    ...(city ? { city } : {}),
  };
}

// --- DOM scraping fallback ---

function scrapeFromDOM(): EventPayload | null {
  const match = window.location.pathname.match(/\/events\/(\d+)/);
  if (!match) return null;
  const facebookId = match[1];

  const titleEl =
    document.querySelector<HTMLElement>("h1") ??
    document.querySelector<HTMLElement>('[data-testid="event-name"]');
  const title = titleEl?.textContent?.trim();
  if (!title) return null;

  const timeEl =
    document.querySelector("time") ??
    document.querySelector('[data-testid="event-time-info"]');
  const dateStr =
    timeEl?.getAttribute("datetime") ?? timeEl?.textContent ?? null;
  const start = dateStr
    ? Math.floor(new Date(dateStr).getTime() / 1000)
    : Math.floor(Date.now() / 1000);

  return {
    facebook_id: facebookId,
    title,
    start,
    source_url: window.location.href,
  };
}

function scoreRaw(raw: FbRaw): number {
  let s = 0;
  if (raw.event_place !== undefined) s += 4;
  if (raw.cover !== undefined) s += 2;
  if (raw.description !== undefined) s += 2;
  if (raw.end_timestamp !== undefined) s += 1;
  if (typeof raw.url === "string") s += 1;
  return s;
}

function safeSend(msg: unknown): void {
  try {
    chrome.runtime.sendMessage(msg);
  } catch {
    // Extension context invalidated after reload — page must be refreshed.
  }
}

// --- Main ---

async function main(): Promise<void> {
  const channel = await injectPageScript();

  const submittedIds = new Set<string>();
  type Pending = { node: FbRaw; score: number; timer: ReturnType<typeof setTimeout> };
  const pendingNodes = new Map<string, Pending>();

  function flush(id: string): void {
    const p = pendingNodes.get(id);
    if (!p) return;
    pendingNodes.delete(id);
    if (submittedIds.has(id)) return;
    submittedIds.add(id);
    const payload = buildPayload(p.node);
    safeSend({ type: "FB_EVENT", payload });
    console.log("[FLARE] Captured event:", payload.title);
  }

  const DROPPED_NAMES = new Set(["Chats", "Notifications"]);

  function submit(raw: FbRaw): void {
    const id = String(raw.id);
    if (submittedIds.has(id)) return;
    if (typeof raw.name === "string" && DROPPED_NAMES.has(raw.name)) return;

    // Only process events that match the specific event page we're on.
    // This prevents stub nodes from listing-page responses polluting submissions.
    const urlMatch = window.location.pathname.match(/\/events\/(\d+)/);
    if (!urlMatch || urlMatch[1] !== id) return;

    const score = scoreRaw(raw);
    const existing = pendingNodes.get(id);

    if (existing) {
      clearTimeout(existing.timer);
      // Keep the richer node; reset the debounce window.
      const best = score > existing.score ? { node: raw, score } : { node: existing.node, score: existing.score };
      pendingNodes.set(id, { ...best, timer: setTimeout(() => flush(id), 1500) });
    } else {
      pendingNodes.set(id, { node: raw, score, timer: setTimeout(() => flush(id), 1500) });
    }
  }

  document.addEventListener(channel, (e: Event) => {
    submit((e as CustomEvent<FbRaw>).detail);
  });

  // DOM fallback fires 2 seconds after page load if nothing was captured via XHR.
  window.addEventListener("load", () => {
    const urlMatch = window.location.pathname.match(/\/events\/(\d+)/);
    if (!urlMatch) return;
    const id = urlMatch[1];
    setTimeout(() => {
      if (submittedIds.has(id) || pendingNodes.has(id)) return;
      const payload = scrapeFromDOM();
      if (payload && !DROPPED_NAMES.has(payload.title)) {
        submittedIds.add(id);
        safeSend({ type: "FB_EVENT", payload });
        console.log("[FLARE] DOM-scraped event:", payload.title);
      }
    }, 2000);
  });
}

main().catch(() => {});
