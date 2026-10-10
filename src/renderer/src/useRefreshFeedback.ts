// 刷新钮的诚实反馈:点了就转圈(至少转满一圈,再快的刷新也看得见),
// 做完用 Toast 说结果;失败也说,带上人话原因,不静默。
import { useRef, useState } from 'react'
import { cleanErrMsg } from './errText'

/** 最短转动时长,与 tokens.css 的 --dur-spin 同值:刷新瞬间完成也要让人看清「收到了」 */
const MIN_SPIN_MS = 600

/** 刷新任务:返回要提示的结果文案;返回 null 表示结果已由别处呈现(如整页错误态),不再 Toast */
export type RefreshTask = () => Promise<string | null>

export function useRefreshFeedback(showToast: (text: string) => void): {
  refreshing: boolean
  runRefresh: (task: RefreshTask) => Promise<void>
} {
  const [refreshing, setRefreshing] = useState(false)
  const isBusy = useRef(false)

  async function runRefresh(task: RefreshTask): Promise<void> {
    if (isBusy.current) return
    isBusy.current = true
    setRefreshing(true)
    const minSpin = new Promise<void>((resolve) => setTimeout(resolve, MIN_SPIN_MS))
    let message: string | null
    try {
      message = await task()
    } catch (err) {
      message = `刷新失败:${cleanErrMsg(err)}`
    }
    await minSpin
    isBusy.current = false
    setRefreshing(false)
    if (message) showToast(message)
  }

  return { refreshing, runRefresh }
}
