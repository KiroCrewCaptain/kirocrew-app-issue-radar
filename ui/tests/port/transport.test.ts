/** Every call goes through the host's scoped client, and its refusals read as the
 * `Response` the built-in's call sites decode (`src/transport.ts`). */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { appFetch, setTransport } from '../../src/transport'
import { issueRadarApi } from '../../src/api'

afterEach(() => setTransport(null))

describe('appFetch', () => {
  it('sends the path and init through the transport the page root set', async () => {
    const raw = vi.fn(async () => new Response('{"repos":[]}', { status: 200 }))
    setTransport({ raw })
    await expect(issueRadarApi.repos()).resolves.toEqual({ repos: [] })
    expect(raw).toHaveBeenCalledWith('/api/apps/issue-radar/repos', { credentials: 'same-origin' })
  })

  it("turns the scoped client's thrown refusal back into the Response, so the backend's error reaches the caller", async () => {
    const refusal = Object.assign(new Error('API 403'), {
      status: 403,
      body: JSON.stringify({ error: 'owner authorization required', code: 'owner_only' }),
    })
    setTransport({ raw: vi.fn(async () => { throw refusal }) })
    const r = await appFetch('/api/apps/issue-radar/connect', { method: 'POST' })
    expect(r.status).toBe(403)
    expect(await r.json()).toEqual({ error: 'owner authorization required', code: 'owner_only' })
  })

  it('rethrows a failure that carries no HTTP status (a network error)', async () => {
    setTransport({ raw: vi.fn(async () => { throw new TypeError('Failed to fetch') }) })
    await expect(appFetch('/api/apps/issue-radar/repos')).rejects.toThrow('Failed to fetch')
  })

  it('falls back to a same-origin fetch before the root mounts', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
    await appFetch('/api/apps/issue-radar/me')
    expect(fetchSpy).toHaveBeenCalledWith('/api/apps/issue-radar/me', { credentials: 'same-origin' })
  })
})
