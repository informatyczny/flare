// Runs in the page's main world — no Chrome extension APIs available here.
// Patches XHR and fetch to intercept Facebook GraphQL responses,
// then fires a CustomEvent on document so content.ts can relay it.

type FbRaw = Record<string, unknown>;

function isEventNode(o: FbRaw): boolean {
  // Always require start_timestamp — navigation/chat elements ("Chats", etc.) lack it.
  if (
    typeof o.id !== "string" ||
    typeof o.name !== "string" ||
    typeof o.start_timestamp !== "number"
  ) {
    return false;
  }
  if (o.__typename === "Event") return true;
  // Fallback for responses that omit __typename: require event_place as extra signal.
  return o.event_place !== undefined;
}

function collectEventNodes(obj: unknown, depth: number): FbRaw[] {
  if (depth > 10 || obj === null || typeof obj !== "object") return [];
  if (Array.isArray(obj)) {
    return (obj as unknown[]).flatMap((item) =>
      collectEventNodes(item, depth + 1)
    );
  }
  const o = obj as FbRaw;
  if (isEventNode(o)) return [o];
  return Object.values(o).flatMap((v) => collectEventNodes(v, depth + 1));
}

function scoreNode(o: FbRaw): number {
  let s = 0;
  if (o.event_place !== undefined) s += 4;
  if (o.cover !== undefined) s += 2;
  if (o.description !== undefined) s += 2;
  if (typeof o.end_timestamp === "number") s += 1;
  if (typeof o.url === "string") s += 1;
  return s;
}

function tryDispatch(text: string): void {
  // Facebook sometimes uses newline-delimited JSON
  const chunks = text.includes("\n")
    ? text.split("\n").filter((l) => l.trim().startsWith("{"))
    : [text];

  const urlMatch = window.location.pathname.match(/\/events\/(\d+)/);
  const pageEventId = urlMatch?.[1];

  for (const chunk of chunks) {
    try {
      const data: unknown = JSON.parse(chunk);
      const nodes = collectEventNodes(data, 0);
      if (!nodes.length) continue;

      // Prefer nodes whose id matches the current page's event ID.
      const idMatches = pageEventId
        ? nodes.filter((n) => String(n.id) === pageEventId)
        : nodes;
      const pool = idMatches.length ? idMatches : nodes;

      // Among candidates, pick the richest (most event-specific fields).
      const best = pool.reduce((a, b) => (scoreNode(a) >= scoreNode(b) ? a : b));

      document.dispatchEvent(new CustomEvent("__fb_event__", { detail: best }));
      return;
    } catch {
      // ignore parse errors
    }
  }
}

function isGraphQL(url: string): boolean {
  return url.includes("/api/graphql") || url.includes("graphql?");
}

// --- Patch XHR ---
const _open = XMLHttpRequest.prototype.open;
const _send = XMLHttpRequest.prototype.send;
const xhrUrls = new WeakMap<XMLHttpRequest, string>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(XMLHttpRequest.prototype.open as any) = function (
  this: XMLHttpRequest,
  method: string,
  url: string | URL
) {
  xhrUrls.set(this, url.toString());
  // eslint-disable-next-line prefer-rest-params
  return (_open as Function).apply(this, arguments);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(XMLHttpRequest.prototype.send as any) = function (this: XMLHttpRequest) {
  const url = xhrUrls.get(this) ?? "";
  if (isGraphQL(url)) {
    this.addEventListener("load", () => tryDispatch(this.responseText));
  }
  // eslint-disable-next-line prefer-rest-params
  return (_send as Function).apply(this, arguments);
};

// --- Patch fetch ---
const _fetch = window.fetch.bind(window);
window.fetch = async (
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
      ? input.href
      : (input as Request).url;

  const response = await _fetch(input, init);

  if (isGraphQL(url)) {
    response
      .clone()
      .text()
      .then(tryDispatch)
      .catch(() => {});
  }

  return response;
};
