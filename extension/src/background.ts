import type {
  EventPayload,
  ExtensionConfig,
  ImportKeyRequest,
  RegistrationRequest,
  StatusData,
  VolunteerIdentity,
} from "./types";
import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";

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

const DEFAULT_CONFIG: ExtensionConfig = {
  backendUrl: "http://localhost:8000",
};

async function getConfig(): Promise<ExtensionConfig> {
  const result = await chrome.storage.sync.get(DEFAULT_CONFIG);
  return result as ExtensionConfig;
}

async function getVolunteer(): Promise<VolunteerIdentity | null> {
  const result = await chrome.storage.local.get("volunteer");
  return result.volunteer || null;
}

async function saveVolunteer(volunteer: VolunteerIdentity): Promise<void> {
  await chrome.storage.local.set({ volunteer });
}

async function ensureVolunteer(): Promise<VolunteerIdentity> {
  let volunteer = await getVolunteer();

  if (!volunteer) {
    const secretKey = generateSecretKey();
    const publicKey = getPublicKey(secretKey);
    volunteer = {
      pubkey: publicKey,
      privateKey: bytesToHex(secretKey),
      nickname: "",
      status: "unregistered",
    };
    await saveVolunteer(volunteer);
  }

  return volunteer;
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

async function registerVolunteer(
  request: RegistrationRequest
): Promise<{ success: boolean; message: string }> {
  const volunteer = await ensureVolunteer();
  const config = await getConfig();

  try {
    const response = await fetch(`${config.backendUrl}/api/volunteers/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pubkey: volunteer.pubkey,
        invite_token: request.inviteToken,
        nickname: request.nickname,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      return {
        success: false,
        message: error.detail || "Registration failed",
      };
    }

    const result = await response.json();
    volunteer.status = result.trust_status || "probation";
    volunteer.nickname = request.nickname;
    volunteer.registeredAt = Date.now();
    await saveVolunteer(volunteer);

    return { success: true, message: "Registered successfully" };
  } catch (err) {
    console.error("[FBE background] Registration failed:", err);
    return { success: false, message: String(err) };
  }
}

async function importPrivateKey(
  request: ImportKeyRequest
): Promise<{ success: boolean; message: string }> {
  try {
    let secretKeyBytes: Uint8Array;
    const raw = request.privateKey.trim();

    if (raw.startsWith("nsec1")) {
      const decoded = nip19.decode(raw);
      if (decoded.type !== "nsec") throw new Error("Not a valid nsec key");
      secretKeyBytes = decoded.data as Uint8Array;
    } else {
      if (!/^[0-9a-fA-F]{64}$/.test(raw)) throw new Error("Not a valid 64-char hex key");
      secretKeyBytes = hexToBytes(raw);
    }

    const pubkey = getPublicKey(secretKeyBytes);
    const privateKeyHex = bytesToHex(secretKeyBytes);
    const config = await getConfig();

    // Look up whether this pubkey is already a registered volunteer
    let nickname = "";
    let status: VolunteerIdentity["status"] = "unregistered";
    try {
      const res = await fetch(
        `${config.backendUrl}/api/volunteers/status?pubkey=${pubkey}`
      );
      if (res.ok) {
        const data = await res.json();
        nickname = data.nickname ?? "";
        status = data.status ?? "probation";
      }
    } catch {
      // Backend unreachable — import key anyway; status will sync on next submit
    }

    await saveVolunteer({ pubkey, privateKey: privateKeyHex, nickname, status });
    return { success: true, message: status };
  } catch (err) {
    return { success: false, message: String(err) };
  }
}

function signPayload(payload: Record<string, unknown>, privateKeyHex: string): string {
  // Exclude null/undefined so the canonical JSON matches the backend's None-filtered dict.
  // Keys are sorted so both sides produce identical byte strings.
  const filtered = Object.fromEntries(
    Object.entries(payload)
      .filter(([, v]) => v !== undefined && v !== null)
      .sort(([a], [b]) => a.localeCompare(b))
  );
  const canonical = JSON.stringify(filtered);
  const msgHash = sha256(new TextEncoder().encode(canonical));
  return bytesToHex(schnorr.sign(msgHash, hexToBytes(privateKeyHex)));
}

async function submitEvent(payload: EventPayload): Promise<void> {
  const config = await getConfig();
  const volunteer = await getVolunteer();

  if (!volunteer) {
    await saveStatus(payload.title, "error");
    console.error("[FBE background] Volunteer not registered");
    return;
  }

  try {
    const payloadWithSignature = {
      ...payload,
      volunteer_pubkey: volunteer.pubkey,
      signature: signPayload(
        {
          city: payload.city,
          cover_url: payload.cover_url,
          description: payload.description,
          end: payload.end,
          facebook_id: payload.facebook_id,
          location: payload.location,
          source_url: payload.source_url,
          start: payload.start,
          title: payload.title,
          volunteer_pubkey: volunteer.pubkey,
        },
        volunteer.privateKey
      ),
    };

    const response = await fetch(`${config.backendUrl}/api/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payloadWithSignature),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const result = (await response.json()) as {
      status: string;
      nostr_id?: string;
    };
    const status =
      result.status === "published"
        ? "published"
        : result.status === "duplicate"
          ? "duplicate"
          : result.status === "queued"
            ? "queued"
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
    message: {
      type: string;
      payload?: EventPayload;
      request?: RegistrationRequest;
    },
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
      return true;
    } else if (message.type === "GET_VOLUNTEER") {
      ensureVolunteer().then((volunteer) => {
        const nsec = nip19.nsecEncode(hexToBytes(volunteer.privateKey));
        sendResponse({ volunteer, nsec });
      });
      return true;
    } else if (message.type === "REGISTER" && message.request) {
      registerVolunteer(message.request).then(sendResponse);
      return true;
    } else if (message.type === "IMPORT_KEY" && message.request) {
      importPrivateKey(message.request).then(sendResponse);
      return true;
    }
  }
);
