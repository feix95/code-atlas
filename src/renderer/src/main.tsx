import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { DevLogsPage } from './DevLogsPage'
import { ErrorBoundary } from './components/ErrorBoundary'
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

// 画面心跳(救生圈2.0)住在 App 组件里(React 树内):树活着心跳才跳。
// 不再放这儿(树外)—— 2026-09-13 白屏案实锤:渲染期异常把 React 树整棵卸载时,
// 树外的 rAF 照跳不误,主进程看门狗被假心跳骗住永远不出手,窗就永久白屏隐身。

// 顶层兜底网(2026-09-13 隐身案第二课):渲染期异常以前会把整棵 React 树卸掉,
// 透明窗一白屏就是整窗「隐身」—— 现在最外层网接住,窗还在、话说人话、一键整页重挂。
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {view === 'devlogs' ? (
      <DevLogsPage />
    ) : (
      <ErrorBoundary
        variant="top"
        note="界面出了个岔子崩了,别慌,程序还在。点下面按钮整个重新打开就能接着用;刚聊的内容没能保住,抱歉。"
        reloadLabel="重新打开界面"
      >
        <App />
      </ErrorBoundary>
    )}
  </React.StrictMode>
)
