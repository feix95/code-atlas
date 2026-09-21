import { createContext } from 'react'
import type { TeachingLevel } from '@shared/personalization'
export interface AiSetupState {
  configured: boolean | null
  openSettings: () => void
}
export const AiSetupContext = createContext<AiSetupState | null>(null)

/**
 * 讲解深度(教学三档)的广播频道(提示词体系重写第二批):设置页改了档,
 * 正在看的旧讲解是按旧档讲的 —— 档位一换,讲解钩子(useAiAsk)就清场重讲,不留旧账。
 * 默认 'brief' 和 sanitize 口径一致;App.tsx 读 AI 配置时同步进来。
 */
export const TeachingContext = createContext<TeachingLevel>('brief')
