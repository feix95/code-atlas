// 在线 API Key 的落盘加密:Electron safeStorage(Windows 走 DPAPI,绑定当前系统账户)。
// 只在 app ready 之后调用(IPC 处理期间),isEncryptionAvailable 在 ready 前不可靠。
import { safeStorage } from 'electron'
import { addDevLog } from '../shared/devlog.ts'
import { setSecretCodec, type SecretCodec } from '../ai/secretCodec.ts'

const electronCodec: SecretCodec = {
  encrypt(plain) {
    if (!safeStorage.isEncryptionAvailable()) {
      addDevLog('system', 'safeStorage 不可用:在线 API Key 按明文保存')
      return null
    }
    return safeStorage.encryptString(plain).toString('base64')
  },
  decrypt(cipher) {
    try {
      return safeStorage.decryptString(Buffer.from(cipher, 'base64'))
    } catch (err) {
      addDevLog(
        'system',
        `在线 API Key 解密失败(可能换了电脑或系统账户),需重新填写:${err instanceof Error ? err.message : String(err)}`
      )
      return null
    }
  }
}

export function installSafeStorageCodec(): void {
  setSecretCodec(electronCodec)
}
