/** 翻译目标语种户籍:菜单里摆什么、提示词里怎么说、页签名上挂什么,都只认这一份 */

export interface TranslateLang {
  /** 稳定代号:页签账本、缓存键、IPC 里都用它 */
  code: string
  /** 菜单与页签上的中文名 */
  label: string
  /** 英文语言名(英文提示词的 target_language) */
  enName: string
}

export const TRANSLATE_LANGS: readonly TranslateLang[] = [
  { code: 'zh-CN', label: '中文（简体）', enName: 'Simplified Chinese' },
  { code: 'zh-TW', label: '繁體中文', enName: 'Traditional Chinese' },
  { code: 'en', label: 'English', enName: 'English' },
  { code: 'ja', label: '日本語', enName: 'Japanese' },
  { code: 'ko', label: '한국어', enName: 'Korean' },
  { code: 'fr', label: 'Français', enName: 'French' },
  { code: 'de', label: 'Deutsch', enName: 'German' },
  { code: 'es', label: 'Español', enName: 'Spanish' }
]

/** 代号 → 语种;不认识的代号回 null(账本里可能有旧值) */
export function translateLang(code: string): TranslateLang | null {
  return TRANSLATE_LANGS.find((l) => l.code === code) ?? null
}
