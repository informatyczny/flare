export interface EventPayload {
  facebook_id: string;
  title: string;
  start: number;
  end?: number;
  description?: string;
  location?: string;
  cover_url?: string;
  source_url: string;
  city?: string;
  volunteer_pubkey: string;
  signature: string;
}

export interface VolunteerIdentity {
  pubkey: string;
  privateKey: string;
  nickname: string;
  status: "unregistered" | "probation" | "trusted" | "banned";
  registeredAt?: number;
}

export interface ExtensionConfig {
  backendUrl: string;
}

export interface StatusData {
  lastEvent?: string;
  lastStatus?: "published" | "duplicate" | "queued" | "error";
  lastTime?: number;
}

export interface RegistrationRequest {
  inviteToken: string;
  nickname: string;
}

export interface ImportKeyRequest {
  privateKey: string; // hex or nsec1…
}

export type ContentMessage =
  | { type: "FB_EVENT"; payload: EventPayload }
  | { type: "GET_STATUS" }
  | { type: "REGISTER"; request: RegistrationRequest }
  | { type: "IMPORT_KEY"; request: ImportKeyRequest }
  | { type: "GET_VOLUNTEER" };

export type BackgroundResponse =
  | { ok: true }
  | StatusData
  | { volunteer: VolunteerIdentity; nsec: string }
  | { status: string; trust_status?: string };
