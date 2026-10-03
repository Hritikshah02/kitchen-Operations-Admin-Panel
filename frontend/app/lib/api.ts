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

export async function apiFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const response = await fetch(`${apiUrl}${path}`, { ...init, headers, credentials: "include" });
  if (response.status === 401) dispatchUnauthorized();
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(response.status, typeof body?.message === "string" ? body.message : "Something went wrong.");
  }
  return response;
}
