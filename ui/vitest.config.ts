import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Root-relative: Vite resolves a leading `/` against this directory.
const stub = (name: string) => `/tests/stubs/${name}`

// The two host SDK modules exist only inside a running dashboard (its import map
// serves them). Tests resolve them to light local stubs instead, and a test that
// needs a different host shape overrides them with `vi.mock`. No network.
//
// The environment is the dashboard's own (happy-dom, UTC, globals), because these
// are the built-in page's suites and they were written against it.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@kirocrew\/app-sdk\/ui$/, replacement: stub('app-sdk-ui.tsx') },
      { find: /^@kirocrew\/app-sdk$/, replacement: stub('app-sdk.ts') },
    ],
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    env: { TZ: 'UTC' },
    environmentOptions: {
      happyDOM: {
        url: 'http://localhost:6776/',
        settings: {
          disableIframePageLoading: true,
          disableJavaScriptFileLoading: true,
          disableJavaScriptEvaluation: true,
          disableCSSFileLoading: true,
          handleDisabledFileLoadingAsSuccess: true,
          navigation: { disableMainFrameNavigation: true, disableChildFrameNavigation: true },
        },
      },
    },
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
    restoreMocks: true,
    unstubEnvs: true,
    testTimeout: 10_000,
  },
})
