import { createContext } from 'react'
export interface AiSetupState {
  configured: boolean | null
  openSettings: () => void
  /** 当前已站在设置页的 AI 节:状态浮层的「AI 设置」链据此如实置灰,不再发空跳转 */
  isOnAiSettings: boolean
}
export const AiSetupContext = createContext<AiSetupState | null>(null)
