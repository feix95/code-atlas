// Wiki 成品里的固定文案:Markdown 页头与后续 README 共用一份,语种只认 translateLangs 的代号。
import { translateLang } from '../shared/translateLangs.ts'
import { DEFAULT_WIKI_LANGUAGE } from '../shared/wikiTypes.ts'

export interface WikiCopy {
  /** README 的目录页标题 */
  wikiTitle: string
  /** README 里的项目名标签 */
  project: string
  module: string
  group: string
  tags: string
  keyFiles: string
  generatedAt: string
  model: string
  language: string
  truncated: string
  truncatedFiles: string
  truncatedSymbols: string
  truncatedExcerpts: string
  truncatedDoc: string
}

export const WIKI_COPY: Readonly<Record<string, WikiCopy>> = {
  'zh-CN': {
    wikiTitle: '仓库 Wiki',
    project: '项目',
    module: '模块',
    group: '散件组',
    tags: '标签',
    keyFiles: '关键文件',
    generatedAt: '生成时间',
    model: '模型',
    language: '语种',
    truncated: '已裁剪',
    truncatedFiles: '文件',
    truncatedSymbols: '符号',
    truncatedExcerpts: '摘录',
    truncatedDoc: '正文超出长度上限,已截断。'
  },
  'zh-TW': {
    wikiTitle: '倉庫 Wiki',
    project: '專案',
    module: '模組',
    group: '散件組',
    tags: '標籤',
    keyFiles: '關鍵檔案',
    generatedAt: '生成時間',
    model: '模型',
    language: '語種',
    truncated: '已裁剪',
    truncatedFiles: '檔案',
    truncatedSymbols: '符號',
    truncatedExcerpts: '摘錄',
    truncatedDoc: '正文超出長度上限,已截斷。'
  },
  en: {
    wikiTitle: 'Repository Wiki',
    project: 'Project',
    module: 'Module',
    group: 'Scattered files',
    tags: 'Tags',
    keyFiles: 'Key files',
    generatedAt: 'Generated',
    model: 'Model',
    language: 'Language',
    truncated: 'Truncated',
    truncatedFiles: 'files',
    truncatedSymbols: 'symbols',
    truncatedExcerpts: 'excerpts',
    truncatedDoc: 'The document body was cut at the length limit.'
  },
  ja: {
    wikiTitle: 'リポジトリ Wiki',
    project: 'プロジェクト',
    module: 'モジュール',
    group: '散在ファイル',
    tags: 'タグ',
    keyFiles: '主要ファイル',
    generatedAt: '生成日時',
    model: 'モデル',
    language: '言語',
    truncated: '切り詰め',
    truncatedFiles: 'ファイル',
    truncatedSymbols: 'シンボル',
    truncatedExcerpts: '抜粋',
    truncatedDoc: '本文が長さ上限を超えたため、切り詰めました。'
  },
  ko: {
    wikiTitle: '저장소 Wiki',
    project: '프로젝트',
    module: '모듈',
    group: '흩어진 파일',
    tags: '태그',
    keyFiles: '주요 파일',
    generatedAt: '생성 시각',
    model: '모델',
    language: '언어',
    truncated: '잘림',
    truncatedFiles: '파일',
    truncatedSymbols: '심볼',
    truncatedExcerpts: '발췌',
    truncatedDoc: '본문이 길이 한도를 넘어 잘렸습니다.'
  },
  fr: {
    wikiTitle: 'Wiki du dépôt',
    project: 'Projet',
    module: 'Module',
    group: 'Fichiers dispersés',
    tags: 'Étiquettes',
    keyFiles: 'Fichiers clés',
    generatedAt: 'Généré le',
    model: 'Modèle',
    language: 'Langue',
    truncated: 'Tronqué',
    truncatedFiles: 'fichiers',
    truncatedSymbols: 'symboles',
    truncatedExcerpts: 'extraits',
    truncatedDoc: 'Le corps du document a été tronqué à la limite de longueur.'
  },
  de: {
    wikiTitle: 'Repository-Wiki',
    project: 'Projekt',
    module: 'Modul',
    group: 'Verstreute Dateien',
    tags: 'Schlagwörter',
    keyFiles: 'Schlüsseldateien',
    generatedAt: 'Erstellt am',
    model: 'Modell',
    language: 'Sprache',
    truncated: 'Gekürzt',
    truncatedFiles: 'Dateien',
    truncatedSymbols: 'Symbole',
    truncatedExcerpts: 'Auszüge',
    truncatedDoc: 'Der Dokumenttext wurde am Längenlimit abgeschnitten.'
  },
  es: {
    wikiTitle: 'Wiki del repositorio',
    project: 'Proyecto',
    module: 'Módulo',
    group: 'Archivos dispersos',
    tags: 'Etiquetas',
    keyFiles: 'Archivos clave',
    generatedAt: 'Generado',
    model: 'Modelo',
    language: 'Idioma',
    truncated: 'Recortado',
    truncatedFiles: 'archivos',
    truncatedSymbols: 'símbolos',
    truncatedExcerpts: 'extractos',
    truncatedDoc: 'El cuerpo del documento se recortó en el límite de longitud.'
  }
}

/** 语种代号 → 文案;不认识的代号回默认简体中文,绝不留下空文案 */
export function wikiCopy(code: string): WikiCopy {
  return WIKI_COPY[code] ?? WIKI_COPY[DEFAULT_WIKI_LANGUAGE]
}

/** 页头里的语种名用菜单同一份 label;代号认不出就原样显示 */
export function wikiLanguageLabel(code: string): string {
  return translateLang(code)?.label ?? code
}
