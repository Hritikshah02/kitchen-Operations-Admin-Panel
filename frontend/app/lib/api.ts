// Same-origin path proxied to the backend by next.config.ts rewrites.
const apiUrl = "/api";

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

function dispatchUnauthorized() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("kitchenops:unauthorized"));
}

// Nest validation errors arrive as an array of messages; join them so the user sees every problem at once.
function errorMessage(body: unknown): string {
  const message = (body as { message?: unknown } | null)?.message;
  if (Array.isArray(message)) return message.join(" ");
  return typeof message === "string" ? message : "Something went wrong.";
}

export async function apiFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const response = await fetch(`${apiUrl}${path}`, { ...init, headers, credentials: "include" });
  if (response.status === 401) dispatchUnauthorized();
  if (!response.ok) throw new ApiError(response.status, errorMessage(await response.json().catch(() => null)));
  return response;
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, init);
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export const sendJson = (method: "POST" | "PATCH" | "PUT" | "DELETE", body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const messageOf = (caught: unknown, fallback: string) => (caught instanceof ApiError ? caught.message : fallback);
