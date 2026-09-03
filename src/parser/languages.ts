// 语言识别的"户口本":每种语言的名字、后缀、特殊文件名。
// 识别 = 后缀速查优先,认不出再读内容嗅探(见 index.ts)。
export type LanguageCategory = 'code' | 'config' | 'style' | 'doc' | 'text'

export interface LanguageDef {
  id: string
  name: string
  category: LanguageCategory
  extensions?: string[]
  /** 无后缀的特殊文件名,小写匹配,如 Makefile、Dockerfile */
  filenames?: string[]
}

export const LANGUAGES: LanguageDef[] = [
  { id: 'typescript', name: 'TypeScript', category: 'code', extensions: ['.ts', '.mts', '.cts'] },
  { id: 'typescript-react', name: 'TypeScript React', category: 'code', extensions: ['.tsx'] },
  { id: 'javascript', name: 'JavaScript', category: 'code', extensions: ['.js', '.mjs', '.cjs'] },
  { id: 'javascript-react', name: 'JavaScript React', category: 'code', extensions: ['.jsx'] },
  { id: 'python', name: 'Python', category: 'code', extensions: ['.py', '.pyw'] },
  { id: 'java', name: 'Java', category: 'code', extensions: ['.java'] },
  { id: 'c', name: 'C', category: 'code', extensions: ['.c', '.h'] },
  {
    id: 'cpp',
    name: 'C++',
    category: 'code',
    extensions: ['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx']
  },
  { id: 'csharp', name: 'C#', category: 'code', extensions: ['.cs'] },
  { id: 'go', name: 'Go', category: 'code', extensions: ['.go'] },
  { id: 'rust', name: 'Rust', category: 'code', extensions: ['.rs'] },
  { id: 'swift', name: 'Swift', category: 'code', extensions: ['.swift'] },
  { id: 'kotlin', name: 'Kotlin', category: 'code', extensions: ['.kt', '.kts'] },
  { id: 'ruby', name: 'Ruby', category: 'code', extensions: ['.rb'] },
  { id: 'php', name: 'PHP', category: 'code', extensions: ['.php'] },
  { id: 'shell', name: 'Shell', category: 'code', extensions: ['.sh', '.bash', '.zsh'] },
  { id: 'powershell', name: 'PowerShell', category: 'code', extensions: ['.ps1', '.psm1'] },
  { id: 'sql', name: 'SQL', category: 'code', extensions: ['.sql'] },
  { id: 'html', name: 'HTML', category: 'doc', extensions: ['.html', '.htm'] },
  { id: 'css', name: 'CSS', category: 'style', extensions: ['.css'] },
  { id: 'scss', name: 'SCSS', category: 'style', extensions: ['.scss', '.sass'] },
  { id: 'vue', name: 'Vue', category: 'code', extensions: ['.vue'] },
  { id: 'svelte', name: 'Svelte', category: 'code', extensions: ['.svelte'] },
  { id: 'json', name: 'JSON', category: 'config', extensions: ['.json'] },
  { id: 'yaml', name: 'YAML', category: 'config', extensions: ['.yaml', '.yml'] },
  { id: 'toml', name: 'TOML', category: 'config', extensions: ['.toml'] },
  { id: 'ini', name: 'INI 配置', category: 'config', extensions: ['.ini', '.cfg', '.conf'] },
  { id: 'xml', name: 'XML', category: 'config', extensions: ['.xml'] },
  { id: 'markdown', name: 'Markdown', category: 'doc', extensions: ['.md', '.markdown'] },
  { id: 'text', name: '纯文本', category: 'text', extensions: ['.txt'] },
  { id: 'makefile', name: 'Makefile', category: 'code', filenames: ['makefile', 'gnumakefile'] },
  { id: 'dockerfile', name: 'Dockerfile', category: 'code', filenames: ['dockerfile'] },
  {
    id: 'gitignore',
    name: 'Git 忽略规则',
    category: 'config',
    filenames: ['.gitignore', '.gitattributes']
  },
  { id: 'env', name: '环境变量配置', category: 'config', filenames: ['.env'] }
]

export const BY_EXT = new Map<string, LanguageDef>()
export const BY_FILENAME = new Map<string, LanguageDef>()

for (const lang of LANGUAGES) {
  for (const ext of lang.extensions ?? []) BY_EXT.set(ext, lang)
  for (const name of lang.filenames ?? []) BY_FILENAME.set(name, lang)
}
