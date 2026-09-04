import type { ScanDirNode } from '@shared/types'
import { AiAssistCard } from './AiAssist'
import { type AiAssistApi } from '../useAiAsk'
import { Notice } from './Notice'

interface FolderCensus {
  directDirs: number
  directFiles: number
  totalFiles: number
  topLanguages: Array<{ name: string; count: number }>
}

/** 翻这棵子树的家底:直接子项、文件总数、语言构成 —— 全是扫描时到手的真数据 */
function census(dir: ScanDirNode): FolderCensus {
  const langs = new Map<string, number>()
  let totalFiles = 0
  const walk = (node: ScanDirNode): void => {
    for (const child of node.children) {
      if (child.type === 'directory') {
        walk(child)
        continue
      }
      totalFiles += 1
      if (child.language) langs.set(child.language.name, (langs.get(child.language.name) ?? 0) + 1)
    }
  }
  walk(dir)
  return {
    directDirs: dir.children.filter((c) => c.type === 'directory').length,
    directFiles: dir.children.filter((c) => c.type === 'file').length,
    totalFiles,
    topLanguages: [...langs.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 4)
  }
}

/**
 * 文件夹「概览」Tab:不调 AI 也有干货 —— 目录路径、扫描状态、
 * 子文件夹/文件数量、主要语言;没探开的目录老实说还没扫,只提示点箭头展开。
 */
export function FolderOverview({ dir, ai }: { dir: ScanDirNode; ai: AiAssistApi }): React.JSX.Element {
  const info = census(dir)

  return (
    <>
      <div className="section-label">
        目录概览 <span>静态统计 · 选中即得</span>
      </div>
      <section className="card">
        {dir.lazy ? (
          <>
            <Notice kind="warn">这个文件夹还没扫描过 —— 到左边目录树点它旁边的展开箭头,才会探进来。</Notice>
            <p className="card-waiting">选中它不会自动扫描,扫描只由你点开箭头触发。</p>
          </>
        ) : (
          <>
            <div className="metric-grid">
              <div className="metric">
                <strong>{info.directDirs}</strong>
                <span>直接子文件夹</span>
              </div>
              <div className="metric">
                <strong>{info.directFiles}</strong>
                <span>直接文件</span>
              </div>
              <div className="metric">
                <strong>{info.totalFiles}</strong>
                <span>共 {info.totalFiles} 个文件(含子层)</span>
              </div>
              <div className="metric">
                <strong>{dir.truncated ? '不完整' : '完整'}</strong>
                <span>{dir.truncated ? '有的子层没探到(琥珀色是提醒,不是出错)' : '已扫描'}</span>
              </div>
            </div>
            {info.topLanguages.length > 0 && (
              <p className="card-text">
                主要语言:
                {info.topLanguages.map((l) => (
                  <span key={l.name} className="chip chip-muted">
                    {l.name} × {l.count}
                  </span>
                ))}
              </p>
            )}
            {dir.summary && <p className="card-text">{dir.summary.text}</p>}
          </>
        )}
      </section>

      <AiAssistCard
        ai={ai}
        presets={[]}
        idleText="想知道这个文件夹整体是干嘛的?点按钮,AI 看完目录清单后用大白话讲。"
        mainLabel="用大白话讲讲这个文件夹"
      />
    </>
  )
}
