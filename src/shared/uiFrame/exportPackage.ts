// 规格包组装(§13.3):方案 → 相对路径 → 文本。字体文件与截图由主进程按清单补齐。
// 所有产物由同一份 UiFrameDoc 生成(规则 14),不存在分别手写的副本。
import { flutterThemeDart, reactNativeThemeTs, tailwindThemeCss } from './adapters.ts'
import { designJson } from './designJson.ts'
import { deviceFor } from './devices.ts'
import {
  compHtmlPath,
  demoBody,
  demoStyles,
  htmlDocument,
  pageFor,
  pageTemplateHtml,
  STYLE_FILES,
  styleTexts
} from './documents.ts'
import { CUSTOM_ICON_PREFIX, iconSvgRelPath } from './customIcon.ts'
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

/** 每个组件演示页一张预览截图 + 页面参考实现一张(页面按方案平台与设备尺寸截) */
export function previewsFor(doc: UiFrameDoc): PreviewPlan[] {
  const page = pageFor(doc.platform)
  const dev = deviceFor(doc)
  return [
    ...RECIPES.map((r): PreviewPlan => ({
      html: compHtmlPath(r.id),
      png: `preview/${r.id}.png`,
      width: 960,
      height: 0
    })),
    { html: page.htmlPath, png: `preview/${page.id}.png`, width: dev.width, height: dev.height }
  ]
}

/** 文件夹名只留安全字符,避免 Windows 非法字符 */
export function safeFolderName(name: string, stamp: string): string {
  const clean = name.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40) || '方案'
  return `UI规格包_${clean}_${stamp}`
}

export function iconFileNames(doc: UiFrameDoc): string[] {
  return [...new Set(Object.values(doc.icons))].map(iconSvgRelPath)
}

export function buildPackage(doc: UiFrameDoc, assets: PackageAssets): SpecPackage {
  const ctx: MarkupContext = {
    mode: 'export',
    icons: doc.icons,
    lookup: assets.lookup,
    custom: doc.customIcons
  }
  const texts = styleTexts(doc, fontsCss(assets.fontSources, PACKAGE_FONT_URL))
  const link = { kind: 'link' as const, hrefBase: '../' }
  const iconFiles = iconFileNames(doc)
  const page = pageFor(doc.platform)
  const files: Record<string, string> = {
    'README-给AI.md': readmeMd(doc, iconFiles),
    'page-template.html': pageTemplateHtml(doc),
    [page.specPath]: pageMd(doc, page),
    [page.htmlPath]: htmlDocument({
      title: page.title,
      body: page.body,
      styles: page.styles,
      ctx,
      styleMode: link
    }),
    'design.json': designJson(doc),
    'adapters/tailwind.theme.css': tailwindThemeCss(doc),
    'adapters/uiTheme.ts': reactNativeThemeTs(doc),
    'adapters/ui_theme.dart': flutterThemeDart(doc),
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
    // 页面样式只带本平台的那个(另一平台的页面包里本来就没有)
    if ((key === 'home' || key === 'app') && key !== page.styleKey) continue
    files[path] = texts[key]
  }
  for (const file of iconFiles) {
    const name = file.slice('icons/'.length, -'.svg'.length)
    if (name.startsWith('custom-')) {
      const key = name.slice('custom-'.length)
      const raw = doc.customIcons[key]
      if (!raw) throw new Error(`自定义图标不存在:${CUSTOM_ICON_PREFIX}${key}`)
      files[file] = `<!-- 自定义图标 · ${key} · 随方案携带 -->\n${raw}\n`
      continue
    }
    const node = assets.lookup(name)
    if (!node) throw new Error(`图标不存在:${name}`)
    files[file] = svgFile(name, node)
  }
  return {
    folderName: safeFolderName(doc.name, assets.stamp),
    files,
    fonts: fontPlans(assets.fontSources),
    previews: previewsFor(doc)
  }
}
