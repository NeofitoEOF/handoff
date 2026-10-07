export const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:3000";

const ACCESS_TOKEN_KEY = "handoff_access_token";

export class ApiError extends Error {
  status: number;
  payload: unknown;

  constructor(status: number, payload: unknown) {
    const message =
      payload &&
      typeof payload === "object" &&
      "message" in payload &&
      typeof payload.message === "string"
        ? payload.message
        : `HTTP ${status}`;
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function setAccessToken(token: string | null): void {
  if (token) localStorage.setItem(ACCESS_TOKEN_KEY, token);
  else localStorage.removeItem(ACCESS_TOKEN_KEY);
  window.dispatchEvent(new Event("handoff-auth-change"));
}

async function parseResponse(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const type = response.headers.get("content-type") ?? "";
  if (type.includes("application/json")) return response.json();
  return response.text();
}

async function refreshAccessToken(): Promise<boolean> {
  const response = await fetch(`${API_URL}/v1/auth/refresh`, {
    method: "POST",
    credentials: "include",
  });

  if (!response.ok) {
    setAccessToken(null);
    return false;
  }

  const payload = (await response.json()) as { accessToken: string };
  setAccessToken(payload.accessToken);
  return true;
}

export async function api<T>(
  path: string,
  init: RequestInit = {},
  allowRefresh = true,
): Promise<T> {
  const token = getAccessToken();
  const headers = new Headers(init.headers);

  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });

  if (
    response.status === 401 &&
    allowRefresh &&
    !path.startsWith("/v1/auth/refresh") &&
    !path.startsWith("/v1/auth/login")
  ) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return api<T>(path, init, false);
  }

  const payload = await parseResponse(response);
  if (!response.ok) throw new ApiError(response.status, payload);
  return payload as T;
}

export async function downloadAuthenticated(path: string, filename: string): Promise<void> {
  const token = getAccessToken();
  const response = await fetch(`${API_URL}${path}`, {
    credentials: "include",
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) throw new ApiError(response.status, await parseResponse(response));

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
