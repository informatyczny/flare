import type { ExtensionConfig, StatusData, VolunteerIdentity } from "./types";

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
          : data.lastStatus === "queued"
            ? "⏳"
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

let currentNsec = "";

async function checkRegistration(): Promise<void> {
  let volunteer: VolunteerIdentity;
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_VOLUNTEER" });
    volunteer = response?.volunteer ?? { pubkey: "", privateKey: "", nickname: "", status: "unregistered" };
    currentNsec = response?.nsec ?? "";
  } catch {
    volunteer = { pubkey: "", privateKey: "", nickname: "", status: "unregistered" };
    currentNsec = "";
  }

  const registrationForm = el("registrationForm");
  const mainSection = el("mainSection");

  if (volunteer.status === "unregistered") {
    registrationForm.style.display = "flex";
    mainSection.style.display = "none";
    el<HTMLButtonElement>("registerBtn").addEventListener("click", handleRegister);
  } else {
    registrationForm.style.display = "none";
    mainSection.style.display = "block";
    el<HTMLSpanElement>("volunteerName").textContent = volunteer.nickname || "Anonymous";
    const badge = el<HTMLSpanElement>("volunteerStatus");
    badge.textContent = volunteer.status;
    badge.className = `status-badge ${volunteer.status}`;
    el<HTMLSpanElement>("volunteerPubkey").textContent = volunteer.pubkey.substring(0, 8) + "...";
  }
}

async function handleRegister(): Promise<void> {
  const inviteToken = el<HTMLInputElement>("inviteToken").value.trim();
  const nickname = el<HTMLInputElement>("nickname").value.trim();

  if (!inviteToken) {
    alert("Please enter an invite token");
    return;
  }

  if (!nickname) {
    alert("Please enter a nickname");
    return;
  }

  const registerBtn = el<HTMLButtonElement>("registerBtn");
  registerBtn.disabled = true;
  registerBtn.textContent = "Registering...";

  try {
    const response = await chrome.runtime.sendMessage({
      type: "REGISTER",
      request: { inviteToken, nickname },
    }) as { success: boolean; message: string };

    if (response.success) {
      alert("Registration successful!");
      await checkRegistration();
    } else {
      alert(`Registration failed: ${response.message}`);
    }
  } catch (err) {
    alert(`Error: ${err}`);
  } finally {
    registerBtn.disabled = false;
    registerBtn.textContent = "Register";
  }
}

async function handleImportKey(): Promise<void> {
  const privateKey = el<HTMLInputElement>("importKey").value.trim();
  if (!privateKey) {
    alert("Please enter a private key");
    return;
  }

  const btn = el<HTMLButtonElement>("importBtn");
  btn.disabled = true;
  btn.textContent = "Importing...";

  try {
    const response = await chrome.runtime.sendMessage({
      type: "IMPORT_KEY",
      request: { privateKey },
    }) as { success: boolean; message: string };

    if (response.success) {
      el<HTMLInputElement>("importKey").value = "";
      await checkRegistration();
    } else {
      alert(`Import failed: ${response.message}`);
    }
  } catch (err) {
    alert(`Error: ${err}`);
  } finally {
    btn.disabled = false;
    btn.textContent = "Import Key";
  }
}

async function handleCopyKey(): Promise<void> {
  if (!currentNsec) return;
  await navigator.clipboard.writeText(currentNsec);
  const btn = el<HTMLButtonElement>("copyKeyBtn");
  btn.textContent = "Copied!";
  setTimeout(() => (btn.textContent = "Copy private key (nsec)"), 1500);
}

document.addEventListener("DOMContentLoaded", () => {
  loadConfig();
  loadStatus();
  checkRegistration();
  el("save").addEventListener("click", saveConfig);
  el("importBtn").addEventListener("click", handleImportKey);
  el("copyKeyBtn").addEventListener("click", handleCopyKey);
});
