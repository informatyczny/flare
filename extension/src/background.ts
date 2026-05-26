import type { EventPayload, ExtensionConfig, StatusData } from "./types";

const DEFAULT_CONFIG: ExtensionConfig = {
  backendUrl: "http://localhost:8000",
};

async function getConfig(): Promise<ExtensionConfig> {
  const result = await chrome.storage.sync.get(DEFAULT_CONFIG);
  return result as ExtensionConfig;
}

async function saveStatus(
  eventTitle: string,
  status: StatusData["lastStatus"]
): Promise<void> {
  await chrome.storage.local.set({
    lastEvent: eventTitle,
    lastStatus: status,
    lastTime: Date.now(),
  } satisfies StatusData & { lastTime: number });
}

async function submitEvent(payload: EventPayload): Promise<void> {
  const config = await getConfig();

  try {
    const response = await fetch(`${config.backendUrl}/api/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const result = (await response.json()) as { status: string; nostr_id?: string };
    const status =
      result.status === "published"
        ? "published"
        : result.status === "duplicate"
        ? "duplicate"
        : "error";

    await saveStatus(payload.title, status);
    console.log("[FBE background] Submitted:", result.status, result.nostr_id);
  } catch (err) {
    console.error("[FBE background] Submit failed:", err);
    await saveStatus(payload.title, "error");
  }
}

chrome.runtime.onMessage.addListener(
  (
    message: { type: string; payload?: EventPayload },
    _sender,
    sendResponse: (r: unknown) => void
  ) => {
    if (message.type === "FB_EVENT" && message.payload) {
      submitEvent(message.payload);
      sendResponse({ ok: true });
    } else if (message.type === "GET_STATUS") {
      chrome.storage.local
        .get(["lastEvent", "lastStatus", "lastTime"])
        .then(sendResponse);
      return true; // keep channel open for async response
    }
  }
);
