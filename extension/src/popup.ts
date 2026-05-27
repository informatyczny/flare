import { generateSecretKey, getPublicKey } from "nostr-tools";
import { decode } from "nostr-tools/nip19";

import type { ExtensionConfig, KeyState, StatusData } from "./types";

const DEFAULT_RELAYS: string[] = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band",
];

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function shortKey(hex: string): string {
  return hex.slice(0, 8) + "…" + hex.slice(-6);
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function parsePrivateKey(input: string): KeyState | null {
  const trimmed = input.trim();
  if (trimmed.startsWith("nsec1")) {
    try {
      const decoded = decode(trimmed);
      if (decoded.type !== "nsec") return null;
      const sk = decoded.data as Uint8Array;
      return { secretKey: bytesToHex(sk), pubkey: getPublicKey(sk) };
    } catch {
      return null;
    }
  }
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    const skHex = trimmed.toLowerCase();
    const sk = hexToBytes(skHex);
    return { secretKey: skHex, pubkey: getPublicKey(sk) };
  }
  return null;
}

// --- Storage ---

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

async function saveKeyState(state: KeyState): Promise<void> {
  await chrome.storage.local.set({ keyState: state });
}

async function getRelays(): Promise<string[]> {
  const defaults: ExtensionConfig = { relays: DEFAULT_RELAYS };
  const result = await chrome.storage.sync.get(defaults);
  return (result as ExtensionConfig).relays;
}

async function saveRelays(relays: string[]): Promise<void> {
  const config: ExtensionConfig = { relays };
  await chrome.storage.sync.set(config);
}

// --- Setup screen ---

function showSetup(): void {
  el("setupSection").style.display = "flex";
  el("mainSection").style.display = "none";
}

async function handleGenerate(): Promise<void> {
  const sk = generateSecretKey();
  const state: KeyState = { secretKey: bytesToHex(sk), pubkey: getPublicKey(sk) };
  await saveKeyState(state);
  showMain(state);
}

async function handleImportSetup(): Promise<void> {
  const input = el<HTMLInputElement>("setupImportInput");
  const errEl = el("setupImportError");
  const state = parsePrivateKey(input.value);
  if (!state) {
    errEl.textContent = "Invalid key — paste an nsec1… or 64-char hex private key";
    return;
  }
  errEl.textContent = "";
  await saveKeyState(state);
  showMain(state);
}

// --- Status section ---

async function loadStatus(): Promise<void> {
  const raw = await chrome.storage.local.get([
    "lastEvent",
    "lastStatus",
    "lastTime",
    "relayResults",
  ]);
  const data = raw as StatusData & { lastTime?: number };
  const statusEl = el("status");
  const resultsEl = el("relayResults");

  if (!data.lastEvent) {
    statusEl.textContent = "No events captured yet.";
    statusEl.className = "status idle";
    resultsEl.innerHTML = "";
    return;
  }

  const time = data.lastTime ? ` (${formatTime(data.lastTime)})` : "";
  const icon =
    data.lastStatus === "published" ? "✓" : data.lastStatus === "error" ? "✗" : "~";
  statusEl.textContent = `${icon} ${data.lastEvent}${time}`;
  statusEl.className = `status ${data.lastStatus ?? "idle"}`;

  if (data.relayResults && Object.keys(data.relayResults).length > 0) {
    resultsEl.innerHTML = Object.entries(data.relayResults)
      .map(([url, res]) => {
        const icon2 = res === "ok" ? "✓" : "✗";
        const cls = res === "ok" ? "relay-ok" : "relay-err";
        return `<div class="relay-result ${cls}">${icon2} ${url.replace("wss://", "")}</div>`;
      })
      .join("");
  } else {
    resultsEl.innerHTML = "";
  }
}

// --- Relay list section ---

async function renderRelayList(): Promise<void> {
  const relays = await getRelays();
  const listEl = el("relayList");
  listEl.innerHTML = relays
    .map(
      (url, i) =>
        `<div class="relay-row">
          <span class="relay-url">${url}</span>
          <button class="remove-btn" data-index="${i}">×</button>
        </div>`
    )
    .join("");

  listEl.querySelectorAll<HTMLButtonElement>(".remove-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const idx = parseInt(btn.dataset.index ?? "0", 10);
      const current = await getRelays();
      current.splice(idx, 1);
      await saveRelays(current);
      await renderRelayList();
    });
  });
}

async function handleAddRelay(): Promise<void> {
  const input = el<HTMLInputElement>("newRelay");
  const url = input.value.trim();
  if (!url || !url.startsWith("wss://")) {
    input.setCustomValidity("Must start with wss://");
    input.reportValidity();
    return;
  }
  input.setCustomValidity("");
  const relays = await getRelays();
  if (!relays.includes(url)) {
    relays.push(url);
    await saveRelays(relays);
  }
  input.value = "";
  await renderRelayList();
}

// --- Key management panel (inside main screen) ---

function toggleKeyPanel(): void {
  const panel = el("keyPanel");
  const isHidden = panel.style.display === "none" || panel.style.display === "";
  panel.style.display = isHidden ? "flex" : "none";
  el("manageKeyBtn").textContent = isHidden ? "▲ Hide" : "Manage key";
}

async function handleRegenerateKey(): Promise<void> {
  if (!confirm("Generate a new keypair? Your current key cannot be recovered.")) return;
  const sk = generateSecretKey();
  const state: KeyState = { secretKey: bytesToHex(sk), pubkey: getPublicKey(sk) };
  await saveKeyState(state);
  setDisplayedPubkey(state.pubkey);
  el("keyPanel").style.display = "none";
  el("manageKeyBtn").textContent = "Manage key";
}

async function handleImportMain(): Promise<void> {
  const input = el<HTMLInputElement>("mainImportInput");
  const errEl = el("mainImportError");
  const state = parsePrivateKey(input.value);
  if (!state) {
    errEl.textContent = "Invalid — paste an nsec1… or 64-char hex private key";
    return;
  }
  errEl.textContent = "";
  await saveKeyState(state);
  setDisplayedPubkey(state.pubkey);
  input.value = "";
  el("keyPanel").style.display = "none";
  el("manageKeyBtn").textContent = "Manage key";
}

async function handleCopyKey(): Promise<void> {
  const pubkey = el("pubkeyDisplay").dataset.pubkey;
  if (!pubkey) return;
  await navigator.clipboard.writeText(pubkey);
  const btn = el("copyKeyBtn");
  btn.textContent = "✓";
  setTimeout(() => { btn.textContent = "Copy"; }, 1500);
}

// --- Main screen ---

function setDisplayedPubkey(pubkey: string): void {
  const box = el("pubkeyDisplay");
  box.textContent = shortKey(pubkey);
  box.title = pubkey;
  box.dataset.pubkey = pubkey;
}

function showMain(state: KeyState): void {
  el("setupSection").style.display = "none";
  el("mainSection").style.display = "block";
  setDisplayedPubkey(state.pubkey);
  el("keyPanel").style.display = "none";
  loadStatus();
  renderRelayList();
}

// --- Init ---

async function init(): Promise<void> {
  const state = await getKeyState();
  if (!state) {
    showSetup();
  } else {
    showMain(state);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  init();

  // Setup screen
  el("generateBtn").addEventListener("click", handleGenerate);
  el("setupImportBtn").addEventListener("click", handleImportSetup);
  el<HTMLInputElement>("setupImportInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleImportSetup();
  });

  // Main screen — key management
  el("copyKeyBtn").addEventListener("click", handleCopyKey);
  el("manageKeyBtn").addEventListener("click", toggleKeyPanel);
  el("regenerateKeyBtn").addEventListener("click", handleRegenerateKey);
  el("mainImportBtn").addEventListener("click", handleImportMain);

  // Main screen — relay config
  el("addRelayBtn").addEventListener("click", handleAddRelay);
  el<HTMLInputElement>("newRelay").addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleAddRelay();
  });
});
