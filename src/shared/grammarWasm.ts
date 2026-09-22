// ── tree-sitter 语法账:一本账,高亮和体检都从这里查 ──
// 语法 id = tree-sitter-wasms 包里的语法名;语言户口本的 id → 语法 id 的桥也在这,
// 两边不许再各养一本(从前 highlight/analyzer 各抄一份 GRAMMAR_FILES,新增语法要改两处)。
// 新增语法时同步 electron-builder.yml 的 wasm filter —— selftest-wasmpaths 会拦,别等它拦。

/** 语法 id → 语法 wasm 字典文件名 */
export const GRAMMAR_WASM: Record<string, string> = {
  tsx: 'tree-sitter-tsx.wasm',
  python: 'tree-sitter-python.wasm',
  java: 'tree-sitter-java.wasm',
  go: 'tree-sitter-go.wasm',
  c: 'tree-sitter-c.wasm',
  cpp: 'tree-sitter-cpp.wasm',
  c_sharp: 'tree-sitter-c_sharp.wasm',
  rust: 'tree-sitter-rust.wasm',
  json: 'tree-sitter-json.wasm',
  css: 'tree-sitter-css.wasm',
  html: 'tree-sitter-html.wasm',
  bash: 'tree-sitter-bash.wasm',
  yaml: 'tree-sitter-yaml.wasm',
  toml: 'tree-sitter-toml.wasm'
}

/**
 * 语言户口本的 id(shared/languages.ts)→ 语法 id。
 * TS/JS 四族共用 tsx 超集语法(和体检模块一个思路);csharp 语法包叫 c_sharp;
 * shell 借 bash 语法(.zsh 也沾光)。没收录的语言 = 没语法,老实白字/不体检。
 */
export const LANG_TO_GRAMMAR: Record<string, string> = {
  typescript: 'tsx',
  'typescript-react': 'tsx',
  javascript: 'tsx',
  'javascript-react': 'tsx',
  python: 'python',
  java: 'java',
  go: 'go',
  c: 'c',
  cpp: 'cpp',
  csharp: 'c_sharp',
  rust: 'rust',
  json: 'json',
  css: 'css',
  html: 'html',
  shell: 'bash',
  yaml: 'yaml',
  toml: 'toml'
}
