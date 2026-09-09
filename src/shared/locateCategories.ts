// ── 第一百零八锤:类目直找 ──
// 小白面对搜索框不知道能搜什么;这里把"可能要找的东西"全列成类目词条,
// 点了直接在扫描树里现找 —— 确定性命中,不赌模型。找得到几个是几个,绝不说找不到还甩一句空话。
import type { ScanDirNode, ScanTreeNode } from './types.ts'

export interface CategoryDef {
  label: string
  /** (文件名, 图标名, 速览文本) → 是否属于这一类 */
  match: (name: string, icon: string | undefined, text: string) => boolean
}

/** 类目词条:全项目的文件/文件夹按速览图标和文本来认,榜单按新手最常找的排 */
export const LOCATE_CATEGORIES: CategoryDef[] = [
  { label: '入口', match: (n, icon, text) => icon === 'entry' || /入口|启动/.test(text) || /^(index|main|app)\./i.test(n) },
  { label: '配置', match: (_n, icon, text) => icon === 'config' || /配置/.test(text) },
  { label: '界面代码', match: (_n, icon, text) => icon === 'component' || /界面|组件|页面/.test(text) },
  { label: '样式', match: (_n, icon, text) => icon === 'style' || /样式/.test(text) },
  { label: '测试', match: (n, icon, text) => icon === 'test' || /测试/.test(text) || /\.test\.|\.spec\.|selftest/i.test(n) },
  { label: '工具代码', match: (_n, icon, text) => icon === 'wrench' || /工具/.test(text) },
  { label: '文档', match: (_n, icon, text) => icon === 'doc' || /文档/.test(text) },
  { label: '依赖', match: (_n, icon, text) => icon === 'package' && /依赖|第三方|库/.test(text) },
  { label: '数据库', match: (_n, icon, text) => icon === 'database' || /数据库/.test(text) },
  { label: '打包产物', match: (_n, icon, text) => icon === 'archive' || /打包产物|压缩包/.test(text) }
]

export interface CategoryHit {
  relPath: string
  /** 为什么算它:速览原文或文件名匹配,给用户可查证的理由 */
  reason: string
}

export interface CategoryResult {
  label: string
  hits: CategoryHit[]
  /** 一共找到几处(界面只列前 8,这里留总数说实话) */
  total: number
}

/** 一张卡最多摆 8 个:再多就是名单不是指路,总数照实报 */
const CATEGORY_HITS_MAX = 8

/** 在扫描树里现找一个类目(纯函数,自测覆盖);项目根本身不算命中 */
export function findCategory(tree: ScanDirNode, label: string): CategoryResult {
  const cat = LOCATE_CATEGORIES.find((c) => c.label === label)
  const hits: CategoryHit[] = []
  if (cat) {
    const walk = (node: ScanTreeNode): void => {
      if (node.relPath !== '') {
        const text = node.summary?.text ?? ''
        if (cat.match(node.name, node.summary?.icon, text)) {
          hits.push({ relPath: node.relPath, reason: node.summary ? `速览:${node.summary.text}` : '文件名匹配' })
        }
      }
      if (node.type === 'directory') for (const child of node.children) walk(child)
    }
    walk(tree)
  }
  return { label, hits: hits.slice(0, CATEGORY_HITS_MAX), total: hits.length }
}
