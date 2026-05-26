import type { ExtensionConfig, StatusData } from "./types";

const DEFAULT_CONFIG: ExtensionConfig = {
  backendUrl: "http://localhost:8000",
};

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

async function loadStatus(): Promise<void> {
  const statusEl = el("status");
  try {
    const data = (await chrome.storage.local.get([
      "lastEvent",
      "lastStatus",
      "lastTime",
    ])) as StatusData & { lastTime?: number };

    if (!data.lastEvent) {
      statusEl.textContent = "No events captured yet.";
      statusEl.className = "status idle";
      return;
    }

    const time = data.lastTime ? ` (${formatTime(data.lastTime)})` : "";
    const icon =
      data.lastStatus === "published"
        ? "✓"
        : data.lastStatus === "duplicate"
        ? "~"
        : "✗";

    statusEl.textContent = `${icon} ${data.lastEvent}${time}`;
    statusEl.className = `status ${data.lastStatus ?? "idle"}`;
  } catch {
    statusEl.textContent = "Could not load status.";
    statusEl.className = "status error";
  }
}

async function loadConfig(): Promise<void> {
  const config = (await chrome.storage.sync.get(DEFAULT_CONFIG)) as ExtensionConfig;
  el<HTMLInputElement>("backendUrl").value = config.backendUrl;
}

async function saveConfig(): Promise<void> {
  const backendUrl = el<HTMLInputElement>("backendUrl").value.trim();
  await chrome.storage.sync.set({ backendUrl } satisfies ExtensionConfig);

  const btn = el<HTMLButtonElement>("save");
  btn.textContent = "Saved!";
  setTimeout(() => (btn.textContent = "Save"), 1500);
}

document.addEventListener("DOMContentLoaded", () => {
  loadConfig();
  loadStatus();
  el("save").addEventListener("click", saveConfig);
});
