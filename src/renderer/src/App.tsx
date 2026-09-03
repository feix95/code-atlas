import { useState } from 'react'

interface Versions {
  node: string
  chrome: string
  electron: string
}

// 引擎版本在页面渲染前就能从 preload 拿到,渲染时读一次即可,无需 effect
function readVersions(): Versions | null {
  const v = window.atlas?.versions
  return v ? { node: v.node(), chrome: v.chrome(), electron: v.electron() } : null
}

function App(): React.JSX.Element {
  const [versions] = useState<Versions | null>(readVersions)

  return (
    <main className="welcome">
      <div className="welcome-card">
        <div className="logo">🗺️</div>
        <h1>CodeAtlas</h1>
        <p className="slogan">你的 AI 代码地图 —— 不读代码,也能看懂整个项目</p>
        <div className="engine">
          {versions ? (
            <>
              <span>Electron {versions.electron}</span>
              <span>Node {versions.node}</span>
              <span>Chromium {versions.chrome}</span>
            </>
          ) : (
            <span>引擎启动中……</span>
          )}
        </div>
        <p className="hint">骨架已就位,下一站:目录扫描器 🚧</p>
      </div>
    </main>
  )
}

export default App
