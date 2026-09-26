import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    exclude: [...configDefaults.exclude, 'e2e/**'],
    server: {
      deps: {
        inline: [/@elata-biosciences/],
      },
    },
  },
})
