// Runs in the page's main world — no Chrome extension APIs available here.
// Patches XHR and fetch to intercept Facebook GraphQL responses,
// then fires a CustomEvent on document so content.ts can relay it.

type FbRaw = Record<string, unknown>;

function isEventNode(o: FbRaw): boolean {
  // Facebook tags every GraphQL object with __typename — this is the reliable check.
  if (o.__typename === "Event") {
    return typeof o.id === "string" && typeof o.name === "string";
  }
  // Fallback for responses that omit __typename: require event_place, which is
  // specific to events and absent from chats, users, groups, etc.
  return (
    typeof o.id === "string" &&
    typeof o.name === "string" &&
    typeof o.start_timestamp === "number" &&
    o.event_place !== undefined
  );
}

function findEventNode(obj: unknown, depth: number): FbRaw | null {
  if (depth > 10 || obj === null || typeof obj !== "object") return null;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findEventNode(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const o = obj as FbRaw;
  if (isEventNode(o)) return o;
  for (const key of Object.keys(o)) {
    const found = findEventNode(o[key], depth + 1);
    if (found) return found;
  }
  return null;
}

function tryDispatch(text: string): void {
  // Facebook sometimes uses newline-delimited JSON
  const chunks = text.includes("\n")
    ? text.split("\n").filter((l) => l.trim().startsWith("{"))
    : [text];

  for (const chunk of chunks) {
    try {
      const data: unknown = JSON.parse(chunk);
      const node = findEventNode(data, 0);
      if (node) {
        document.dispatchEvent(
          new CustomEvent("__fb_event__", { detail: node })
        );
        return;
      }
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
