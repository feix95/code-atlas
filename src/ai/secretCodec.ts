// 密钥落盘的加解密适配层(dependency inversion):config.ts 只认这个接口,
// 具体实现由主进程启动时注入(Electron safeStorage);自测可注入假实现,不依赖 Electron。

export interface SecretCodec {
  /** 加密可用时返回密文(base64);不可用返回 null,调用方按明文落盘 */
  encrypt(plain: string): string | null
  /** 解密失败(换了机器/系统账户)返回 null */
  decrypt(cipher: string): string | null
}

let activeCodec: SecretCodec | null = null

export function setSecretCodec(codec: SecretCodec | null): void {
  activeCodec = codec
}

/** 密钥在存档里的形态:加密成功存 apiKeyEnc,加密不可用(未注入/系统不支持)退回明文 apiKey */
export type StoredSecret = { apiKeyEnc: string } | { apiKey: string }

export function sealSecret(plain: string): StoredSecret {
  if (plain === '') return { apiKey: '' }
  const cipher = activeCodec?.encrypt(plain) ?? null
  return cipher === null ? { apiKey: plain } : { apiKeyEnc: cipher }
}

export function openSecret(raw: Record<string, unknown>): string {
  if (typeof raw.apiKeyEnc === 'string' && raw.apiKeyEnc !== '') {
    return activeCodec?.decrypt(raw.apiKeyEnc) ?? ''
  }
  return typeof raw.apiKey === 'string' ? raw.apiKey : ''
}
