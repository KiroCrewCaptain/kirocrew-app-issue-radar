/**
 * The dashboard's `renderWithProviders` (`website/src/test/helpers.tsx`) for this
 * bundle: a fresh React Query client (retries off) around the page. The built-in
 * also mounted the dashboard's Redux store, router and theme; the bundle reads
 * none of them (it reaches the host through `@kirocrew/app-sdk`).
 */
import type { ReactElement, ReactNode } from 'react'
import { render, type RenderOptions } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

interface WrapperOptions extends Omit<RenderOptions, 'wrapper'> {
  route?: string
  queryDefaults?: Record<string, unknown>
}

export function renderWithProviders(ui: ReactElement, { queryDefaults, ...options }: WrapperOptions = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, ...(queryDefaults ?? {}) }, mutations: { retry: false } },
  })
  // A wrapper, not an element around `ui`, so `rerender` keeps the provider.
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { queryClient, ...render(ui, { wrapper, ...options }) }
}
