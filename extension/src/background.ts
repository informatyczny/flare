import { finalizeEvent, getPublicKey } from "nostr-tools";
import type { Event as NostrEvent } from "nostr-tools";

import { mainWorldPatcher } from "./patcher";
import type { EventPayload, ExtensionConfig, StatusData, KeyState } from "./types";

const DEFAULT_RELAYS: string[] = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band",
];

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

async function getKeyState(): Promise<KeyState | null> {
  const result = await chrome.storage.local.get(["keyState", "volunteerState"]);
  if (result.keyState) return result.keyState as KeyState;
  // Migrate from old format
  if (result.volunteerState) {
    const old = result.volunteerState as { pubkey: string; secretKey: string };
    const state: KeyState = { pubkey: old.pubkey, secretKey: old.secretKey };
    await chrome.storage.local.set({ keyState: state });
    await chrome.storage.local.remove("volunteerState");
    return state;
  }
  return null;
}

async function getRelays(): Promise<string[]> {
  const defaults: ExtensionConfig = { relays: DEFAULT_RELAYS };
  const result = await chrome.storage.sync.get(defaults);
  return (result as ExtensionConfig).relays;
}

function buildTags(payload: EventPayload): string[][] {
  const tags: string[][] = [
    ["d", payload.facebook_id],
    ["title", payload.title],
    ["start", String(payload.start)],
  ];
  if (payload.end) tags.push(["end", String(payload.end)]);
  if (payload.location) tags.push(["location", payload.location]);
  if (payload.cover_url) tags.push(["image", payload.cover_url]);
  if (payload.city) tags.push(["l", payload.city, "city"]);
  tags.push(["r", payload.source_url]);
  return tags;
}

function publishToRelay(url: string, event: NostrEvent): Promise<"ok" | "error"> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve("error"), 8000);
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      clearTimeout(timer);
      resolve("error");
      return;
    }
    ws.onopen = () => {
      ws.send(JSON.stringify(["EVENT", event]));
    };
    ws.onmessage = (msg: MessageEvent<string>) => {
      try {
        const data: unknown = JSON.parse(msg.data);
        if (Array.isArray(data) && data[0] === "OK" && data[1] === event.id) {
          clearTimeout(timer);
          ws.close();
          resolve(data[2] === true ? "ok" : "error");
        }
      } catch {
        // ignore parse errors
      }
    };
    ws.onerror = () => {
      clearTimeout(timer);
      resolve("error");
    };
  });
}

async function handleEvent(payload: EventPayload): Promise<void> {
  const state = await getKeyState();
  if (!state) return;

  const relays = await getRelays();
  const tags = buildTags(payload);

  const signed = finalizeEvent(
    {
      kind: 31923,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: payload.description ?? "",
    },
    hexToBytes(state.secretKey)
  );

  const settlements = await Promise.allSettled(
    relays.map(async (url) => ({
      url,
      result: await publishToRelay(url, signed),
    }))
  );

  const relayResults: Record<string, "ok" | "error"> = {};
  for (const s of settlements) {
    if (s.status === "fulfilled") {
      relayResults[s.value.url] = s.value.result;
    }
  }

  const overallStatus: StatusData["lastStatus"] = Object.values(relayResults).some(
    (r) => r === "ok"
  )
    ? "published"
    : "error";

  const statusData: StatusData = {
    lastEvent: payload.title,
    lastStatus: overallStatus,
    lastTime: Date.now(),
    relayResults,
  };
  await chrome.storage.local.set(statusData);
}

chrome.runtime.onMessage.addListener(
  (
    message: { type: string; payload?: EventPayload; channel?: string },
    sender: chrome.runtime.MessageSender,
    sendResponse: (r: unknown) => void
  ): boolean => {
    if (message.type === "INJECT_MAIN_WORLD" && sender.tab?.id && message.channel) {
      chrome.scripting
        .executeScript({
          target: { tabId: sender.tab.id },
          world: "MAIN",
          func: mainWorldPatcher,
          args: [message.channel],
        })
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false }));
      return true;
    }
    if (message.type === "FB_EVENT" && message.payload) {
      handleEvent(message.payload).catch(() => {});
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === "GET_STATUS") {
      chrome.storage.local
        .get(["lastEvent", "lastStatus", "lastTime", "relayResults"])
        .then(sendResponse);
      return true;
    }
    return false;
  }
);
