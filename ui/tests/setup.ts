/**
 * The test floor. The built-in page's suites ran in the dashboard's vitest setup
 * (`website/integration/setup.ts`); these are the parts of it they depend on:
 * happy-dom with `matchMedia`, pointer capture, `IntersectionObserver` (every
 * target intersecting) and `ResizeObserver` stand-ins, an in-memory Web Storage
 * cleared between tests, and the stub host SDK reset after each test.
 */
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'
import { resetStubSdk } from './stubs/app-sdk'

if (typeof window !== 'undefined' && !HTMLElement.prototype.hasPointerCapture) {
  HTMLElement.prototype.hasPointerCapture = function () { return false }
  HTMLElement.prototype.setPointerCapture = function () {}
  HTMLElement.prototype.releasePointerCapture = function () {}
}

if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

if (typeof window !== 'undefined') {
  class StubIntersectionObserver {
    private readonly cb: IntersectionObserverCallback
    constructor(cb: IntersectionObserverCallback) { this.cb = cb }
    observe(target: Element) {
      const entry = {
        isIntersecting: true,
        target,
        intersectionRatio: 1,
        boundingClientRect: target.getBoundingClientRect(),
        intersectionRect: target.getBoundingClientRect(),
        rootBounds: null,
        time: 0,
      } as unknown as IntersectionObserverEntry
      this.cb([entry], this as unknown as IntersectionObserver)
    }
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] { return [] }
  }
  ;(window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = StubIntersectionObserver
  ;(globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = StubIntersectionObserver
}

if (typeof (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver === 'undefined') {
  class StubResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = StubResizeObserver
  if (typeof window !== 'undefined') {
    ;(window as unknown as { ResizeObserver: unknown }).ResizeObserver = StubResizeObserver
  }
}

// A deterministic in-memory Web Storage on `Storage.prototype`, as the dashboard's
// setup installs, so a test that patches `Storage.prototype.setItem` (a full
// quota) reaches the page's storage.
/* eslint-disable @typescript-eslint/no-explicit-any */
const storageProto = (typeof Storage !== 'undefined' && Storage.prototype) || ({} as any)
storageProto.clear = function (this: any): void { this._m.clear() }
storageProto.getItem = function (this: any, k: string): string | null {
  return this._m.has(k) ? this._m.get(k) : null
}
storageProto.key = function (this: any, i: number): string | null {
  return Array.from(this._m.keys())[i] as string ?? null
}
storageProto.removeItem = function (this: any, k: string): void { this._m.delete(k) }
storageProto.setItem = function (this: any, k: string, v: string): void { this._m.set(k, String(v)) }
function makeStorage(): Storage {
  const inst: any = Object.create(storageProto)
  inst._m = new Map<string, string>()
  Object.defineProperty(inst, 'length', { get() { return this._m.size }, configurable: true })
  return inst as Storage
}
for (const prop of ['localStorage', 'sessionStorage'] as const) {
  const store = makeStorage()
  for (const target of [globalThis, typeof window !== 'undefined' ? window : undefined]) {
    if (target) {
      try {
        Object.defineProperty(target, prop, { value: store, writable: true, configurable: true })
      } catch {
        /* a non-configurable host property keeps its own storage */
      }
    }
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

beforeEach(() => {
  try { window.localStorage.clear() } catch { /* no storage */ }
  try { window.sessionStorage.clear() } catch { /* no storage */ }
})

afterEach(() => {
  cleanup()
  resetStubSdk()
})
