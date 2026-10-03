import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import tsconfigPaths from 'vite-tsconfig-paths'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import errorOverlay from '@visulima/vite-overlay'

const config = defineConfig({
  ...(process.env.DEV_BUILD && {
    build: {
      target: 'esnext',
      minify: false,
      cssMinify: false,
      sourcemap: false,
      reportCompressedSize: false,
      modulePreload: {
        polyfill: false,
      },
    },
  }),

  plugins: [
    devtools({ injectSource: { enabled: false } }),

    errorOverlay({
      forwardConsole: true,
      forwardedConsoleMethods: ['error', 'warn'],
    }),

    tsconfigPaths({
      projects: ['./tsconfig.json'],
    }),

    tailwindcss(),

    tanstackStart({
      prerender: {
        enabled: !!process.env.DEV_BUILD,
        autoSubfolderIndex: true,
        autoStaticPathsDiscovery: true,
        crawlLinks: false,
        failOnError: true,
      },
    }),

    nitro(),

    viteReact(),
  ],
})

export default config
