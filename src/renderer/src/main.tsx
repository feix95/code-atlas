import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { initAppearance } from './appearance'
import './assets/main.css'

// 开画之前先把亮暗和配色定下来,免得先闪一帧错的再跳回来
initAppearance()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
