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

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {view === 'devlogs' ? <DevLogsPage /> : <App />}
  </React.StrictMode>
)
