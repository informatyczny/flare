import type { EventPayload } from "./types";

type FbRaw = Record<string, unknown>;

// Inject injected.js into the page's main world so it can patch XHR/fetch.
function injectPageScript(): void {
  const src = chrome.runtime.getURL("dist/injected.js");
  const script = document.createElement("script");
  script.src = src;
  (document.head ?? document.documentElement).appendChild(script);
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

// --- Main ---

async function main(): Promise<void> {
  injectPageScript();

  const submittedIds = new Set<string>();

  function submit(raw: FbRaw): void {
    const id = String(raw.id);
    if (submittedIds.has(id)) return;
    submittedIds.add(id);
    const payload = buildPayload(raw);
    chrome.runtime.sendMessage({ type: "FB_EVENT", payload });
    console.log("[FBE] Captured event:", payload.title);
  }

  document.addEventListener("__fb_event__", (e: Event) => {
    submit((e as CustomEvent<FbRaw>).detail);
  });

  // DOM fallback fires 2 seconds after page load, giving XHR interception priority.
  window.addEventListener("load", () => {
    const urlMatch = window.location.pathname.match(/\/events\/(\d+)/);
    if (!urlMatch) return;
    const id = urlMatch[1];
    setTimeout(() => {
      if (submittedIds.has(id)) return;
      const payload = scrapeFromDOM();
      if (payload) {
        submittedIds.add(id);
        chrome.runtime.sendMessage({ type: "FB_EVENT", payload });
        console.log("[FBE] DOM-scraped event:", payload.title);
      }
    }, 2000);
  });
}

main();
