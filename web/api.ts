export let csrfToken = '';
export function setCsrf(value: string) {
  csrfToken = value;
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
/** Raised on the window when any call answers 401, so the shell can offer to sign in again in place. */
export const UNAUTHENTICATED_EVENT = 'opspilot:unauthenticated';
export const OFFLINE_MESSAGE = 'The server could not be reached. Your work on this page is kept — check the connection and try again.';

export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'include',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(method !== 'GET' ? { 'X-CSRF-Token': csrfToken } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    // Network failure: no response at all. Status 0 lets callers tell it from a server answer.
    throw new ApiError(OFFLINE_MESSAGE, 0);
  }
  if (response.status === 204) return undefined as T;
  // A proxy or gateway may answer with HTML (502, 504, maintenance page). Never let that surface as
  // a JSON parse error; say what happened in words instead.
  let data: { error?: string; issues?: { path: string; message: string }[] } & Record<string, unknown>;
  try {
    data = await response.json();
  } catch {
    if (!response.ok) throw new ApiError(response.status >= 500 ? `The server is not answering properly right now (HTTP ${response.status}). Your work on this page is kept — try again shortly.` : `Unexpected response from the server (HTTP ${response.status}).`, response.status);
    throw new ApiError('The server sent a response that could not be read.', response.status);
  }
  if (!response.ok) {
    if (response.status === 401 && !['/auth/login', '/auth/me', '/auth/logout'].some((p) => path.startsWith(p))) window.dispatchEvent(new CustomEvent(UNAUTHENTICATED_EVENT));
    throw new ApiError(
      (data.error ?? `HTTP ${response.status}`) +
        (data.issues
          ? `: ${data.issues.map((i: { path: string; message: string }) => `${i.path}: ${i.message}`).join('; ')}`
          : ''),
      response.status,
    );
  }
  return data as T;
}
