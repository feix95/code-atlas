// 侧栏与搜索对卡片墙的动作:跳卡选中、打开卡的文档、单页生成这张卡。
import { useCallback, useState } from 'react'

export interface WallPanelActions {
  /** 跳卡请求:WikiWallLayer 收到后选中这张卡 */
  focus: { pageId: string; n: number } | null
  showCard: (pageId: string) => void
  openDoc: (file: string) => void
  /** 单页生成;返回错误文案,成功为 null */
  generateCard: (pageId: string) => Promise<string | null>
}

export function useWallPanelActions(
  rootPath: string,
  language: string,
  openWall: () => void
): WallPanelActions {
  const [focus, setFocus] = useState<{ pageId: string; n: number } | null>(null)

  const showCard = useCallback(
    (pageId: string): void => {
      openWall()
      setFocus((prev) => ({ pageId, n: (prev?.n ?? 0) + 1 }))
    },
    [openWall]
  )

  const openDoc = useCallback(
    (file: string): void => {
      void window.atlas.wiki.openDoc(rootPath, language, file).then((outcome) => {
        if (!outcome.ok) window.alert(outcome.message)
      })
    },
    [rootPath, language]
  )

  const generateCard = useCallback(
    async (pageId: string): Promise<string | null> => {
      const requestId = `panel-${Date.now().toString(36)}`
      try {
        const outcome = await window.atlas.wiki.startV2({
          requestId,
          projectRoot: rootPath,
          language,
          pageIds: [pageId]
        })
        return outcome.ok ? null : outcome.error
      } catch {
        return '启动生成失败,请再试一次'
      }
    },
    [rootPath, language]
  )

  return { focus, showCard, openDoc, generateCard }
}
