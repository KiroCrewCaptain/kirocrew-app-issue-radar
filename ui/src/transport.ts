// How every Issue Radar request reaches the backend.
//
// The routes are served by the gateway's route registry under
// /api/apps/issue-radar (backend/app_hooks.py), the prefix `permissions.api`
// grants. Every request goes through the host's permission-scoped client
// (`useAppApi()`), which the page root hands to `setTransport`: a same-origin
// fetch carrying the dashboard's session cookie, refused in the browser for any
// path outside the manifest's grant.
//
// The built-in's client called `fetch` and read `Response.ok` itself, and every
// call site in api.ts still does. The scoped client instead THROWS on a non-2xx,
// carrying the status and the raw body, so `appFetch` turns that rejection back
// into the `Response` the call sites read, and their error decoding (the
// backend's `error` and `code`) is unchanged.

/** The part of the scoped client this module uses. */
export interface Transport {
  raw(path: string, init?: RequestInit): Promise<Response>
}

/** Before the root mounts (tests, or a module evaluated early): a plain fetch. */
const sameOriginFetch: Transport = {
  raw: (path, init) => fetch(path, { credentials: 'same-origin', ...init }),
}

let transport: Transport = sameOriginFetch

/** Route every call through *next* (the page root passes `useAppApi()`). */
export function setTransport(next: Transport | null): void {
  transport = next ?? sameOriginFetch
}

function rejectionAsResponse(err: unknown): Response | null {
  if (!err || typeof err !== 'object' || !('status' in err)) return null
  const status = (err as { status: unknown }).status
  if (typeof status !== 'number' || status < 200 || status > 599) return null
  const body = (err as { body?: unknown }).body
  return new Response(typeof body === 'string' ? body : '', {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** `fetch` for an Issue Radar path, through the transport. */
export async function appFetch(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await transport.raw(path, init)
  } catch (err) {
    const response = rejectionAsResponse(err)
    if (response) return response
    throw err
  }
}
