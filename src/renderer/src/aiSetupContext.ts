import { createContext } from 'react'
export interface AiSetupState {
  configured: boolean | null
  openSettings: () => void
}
export const AiSetupContext = createContext<AiSetupState | null>(null)
