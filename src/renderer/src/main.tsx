import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { DevLogsPage } from './DevLogsPage'
import { initAppearance } from './appearance'
import './assets/main.css'

// 开画之前先把亮暗和配色定下来,免得先闪一帧错的再跳回来
initAppearance()

// 第八十七锤:Developer 日志窗口复用同一个渲染入口,靠 ?view=devlogs 分流 ——
// 日志窗只画账本页,不碰主应用(也不去调它的 IPC)。
const view = new URLSearchParams(window.location.search).get('view')

// 报错小纸条:没被接住的 JS 错误/未兑现的承诺送进主进程的后台账本 ——
// 渲染层真断了的时候,主进程的账本还活着,下回排查有现场可看(救生圈这锤加的)
window.addEventListener('error', (e) => {
  window.atlas?.reportRendererError(`${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`)
})
window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason instanceof Error ? `${e.reason.name}:${e.reason.message}` : String(e.reason)
  window.atlas?.reportRendererError(`未兑现的承诺:${reason}`)
})

// 画面心跳(救生圈2.0):rAF 每秒向主进程报一跳「画面循环还在转」。隐身案实测定性 ——
// 渲染进程活着但画面管线停摆时,外面的任何抢救都叫不醒,只有整页重挂能救;主进程就靠
// 这跳判断何时动手。日志窗(?view=devlogs)不掺和,主进程那边也只认主窗的跳。
if (view !== 'devlogs') {
  let lastBeat = 0
  const beat = (t: number): void => {
    if (t - lastBeat >= 1000) {
      lastBeat = t
      window.atlas?.frameHeartbeat()
    }
    requestAnimationFrame(beat)
  }
  requestAnimationFrame(beat)
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {view === 'devlogs' ? <DevLogsPage /> : <App />}
  </React.StrictMode>
)
