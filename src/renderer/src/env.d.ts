/// <reference types="vite/client" />

import type { AtlasApi } from '../../preload/index.ts'

declare global {
  interface Window {
    /**
     * window.atlas 的权威类型:从 preload 的桥对象 atlasApi 直接推导(P1-3),
     * 实现改一处签名自动跟着走 —— 不再手抄镜像声明(旧镜像曾和 preload
     * 各养一本,两边字段漂移过:freechat 三兄弟 preload 写 unknown、
     * 声明写 ChatMessage,对不上账)。
     */
    atlas: AtlasApi
  }
}

export {}
