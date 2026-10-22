// 「+」菜单里的联网开关 = 设置页「联网查证」总闸的快捷位。
// 读一份当前配置存 ref,拨一下就把整份配置 + webLookup 翻转存回去,以存档回执为准。
import { useEffect, useRef, useState } from 'react'
import type { AiConfig } from '@shared/types'

export function useWebLookupToggle(): { webOn: boolean; toggleWeb: () => void } {
  const [webOn, setWebOn] = useState(false)
  const cfgRef = useRef<AiConfig | null>(null)

  useEffect(() => {
    let alive = true
    void window.atlas
      .aiConfigGet()
      .then((c) => {
        if (!alive) return
        cfgRef.current = c
        setWebOn(c.webLookup === true)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  function toggleWeb(): void {
    const cur = cfgRef.current
    if (!cur) return
    const next = !webOn
    setWebOn(next)
    void window.atlas
      .aiConfigSave({ ...cur, webLookup: next })
      .then((c) => {
        cfgRef.current = c
        setWebOn(c.webLookup === true)
      })
      .catch(() => setWebOn(!next))
  }

  return { webOn, toggleWeb }
}
