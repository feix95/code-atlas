/// <reference types="vite/client" />

declare global {
  interface Window {
    atlas: {
      versions: {
        node: () => string
        chrome: () => string
        electron: () => string
      }
    }
  }
}

export {}
