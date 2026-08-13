/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />
/// <reference types="vite-plugin-pwa/client" />

interface ReposicionLiveBundle {
  version?: string
  js: string
  css?: string
}

interface Window {
  __Reposicion_LIVE__?: ReposicionLiveBundle | null
}
