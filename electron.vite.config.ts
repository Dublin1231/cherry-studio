import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'path'
import { visualizer } from 'rollup-plugin-visualizer'

const visualizerPlugin = (type: 'renderer' | 'main') => {
  return process.env[`VISUALIZER_${type.toUpperCase()}`] ? [visualizer({ open: true })] : []
}

process.env.ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
process.env.ELECTRON_CUSTOM_DIR = '31.7.6'
process.env.ELECTRON_SKIP_BINARY_DOWNLOAD = '0'

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        include: ['electron'],
        exclude: [
          '@llm-tools/embedjs',
          '@llm-tools/embedjs-openai',
          '@llm-tools/embedjs-loader-web',
          '@llm-tools/embedjs-loader-markdown',
          '@llm-tools/embedjs-loader-msoffice',
          '@llm-tools/embedjs-loader-xml',
          '@llm-tools/embedjs-loader-pdf',
          '@llm-tools/embedjs-loader-sitemap',
          '@llm-tools/embedjs-libsql'
        ]
      }),
      ...visualizerPlugin('main')
    ],
    resolve: {
      alias: {
        '@main': resolve('src/main'),
        '@types': resolve('src/renderer/src/types'),
        '@shared': resolve('packages/shared'),
        electron: resolve('node_modules/electron')
      }
    },
    build: {
      rollupOptions: {
        external: ['@libsql/client', 'electron']
      }
    }
  },
  preload: {
    plugins: [
      externalizeDepsPlugin({
        include: ['electron']
      })
    ],
    resolve: {
      alias: {
        electron: resolve('node_modules/electron')
      }
    },
    build: {
      rollupOptions: {
        external: ['electron']
      }
    }
  },
  renderer: {
    plugins: [react(), ...visualizerPlugin('renderer')],
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('packages/shared'),
        electron: resolve('node_modules/electron')
      }
    },
    optimizeDeps: {
      include: ['electron'],
      exclude: ['chunk-PZ64DZKH.js', 'chunk-JMKENWIY.js']
    }
  }
})
