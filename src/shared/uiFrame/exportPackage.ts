// 规格包组装(§13.3):方案 → 相对路径 → 文本。字体文件与截图由主进程按清单补齐。
// 所有产物由同一份 UiFrameDoc 生成(规则 14),不存在分别手写的副本。
import { designJson } from './designJson.ts'
import {
  compHtmlPath,
  demoBody,
  demoStyles,
  HOME_PAGE,
  htmlDocument,
  PAGE_STYLES,
  pageTemplateHtml,
  STYLE_FILES,
  styleTexts
} from './documents.ts'
import { fontPlans, fontsCss, PACKAGE_FONT_URL, type FontSource } from './fonts.ts'
import { svgFile, type MarkupContext } from './markup.ts'
import { RECIPES } from './recipes/index.ts'
import { licensesMd, pageMd, readmeMd, type LicenseTexts } from './readme.ts'
import type { IconLookup, PreviewPlan, SpecPackage, UiFrameDoc } from './types.ts'

export interface PackageAssets {
  lookup: IconLookup
  fontSources: FontSource[]
  licenses: LicenseTexts
  /** 文件夹名里的时间戳,如 20261002-1530(由调用方给,保持本函数为纯函数) */
  stamp: string
}

/** 每个组件演示页一张预览截图 + 页面参考实现一张 */
export const PREVIEWS: PreviewPlan[] = [
  ...RECIPES.map((r): PreviewPlan => ({
    html: compHtmlPath(r.id),
    png: `preview/${r.id}.png`,
    width: 960,
    height: 0
  })),
  {
    html: 'pages/home.html',
    png: 'preview/home.png',
    width: HOME_PAGE.width,
    height: HOME_PAGE.height
  }
]

/** 文件夹名只留安全字符,避免 Windows 非法字符 */
export function safeFolderName(name: string, stamp: string): string {
  const clean = name.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40) || '方案'
  return `UI规格包_${clean}_${stamp}`
}

export function iconFileNames(doc: UiFrameDoc): string[] {
  return [...new Set(Object.values(doc.icons))].map((n) => `icons/${n}.svg`)
}

export function buildPackage(doc: UiFrameDoc, assets: PackageAssets): SpecPackage {
  const ctx: MarkupContext = { mode: 'export', icons: doc.icons, lookup: assets.lookup }
  const texts = styleTexts(doc, fontsCss(assets.fontSources, PACKAGE_FONT_URL))
  const link = { kind: 'link' as const, hrefBase: '../' }
  const iconFiles = iconFileNames(doc)
  const files: Record<string, string> = {
    'README-给AI.md': readmeMd(doc, iconFiles),
    'page-template.html': pageTemplateHtml(),
    'pages/home.md': pageMd(doc),
    'pages/home.html': htmlDocument({
      title: HOME_PAGE.title,
      body: HOME_PAGE.body,
      styles: PAGE_STYLES,
      ctx,
      styleMode: link
    }),
    'design.json': designJson(doc),
    'LICENSES.md': licensesMd(assets.licenses)
  }
  for (const r of RECIPES) {
    files[compHtmlPath(r.id)] = htmlDocument({
      title: `${r.label} · 演示`,
      body: demoBody(r.id),
      styles: demoStyles(r.id),
      ctx,
      styleMode: link
    })
  }
  for (const [key, path] of Object.entries(STYLE_FILES) as Array<[keyof typeof texts, string]>) {
    files[path] = texts[key]
  }
  for (const file of iconFiles) {
    const name = file.slice('icons/'.length, -'.svg'.length)
    const node = assets.lookup(name)
    if (!node) throw new Error(`图标不存在:${name}`)
    files[file] = svgFile(name, node)
  }
  return {
    folderName: safeFolderName(doc.name, assets.stamp),
    files,
    fonts: fontPlans(assets.fontSources),
    previews: PREVIEWS
  }
}
