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
}

export interface ExtensionConfig {
  backendUrl: string;
}

export interface StatusData {
  lastEvent?: string;
  lastStatus?: "published" | "duplicate" | "error";
  lastTime?: number;
}

export type ContentMessage =
  | { type: "FB_EVENT"; payload: EventPayload }
  | { type: "GET_STATUS" };

export type BackgroundResponse = { ok: true } | StatusData;
