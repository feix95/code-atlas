import { TreeIcon } from './Icons'
import { CfgRow } from './CfgRow'

/** 「关于」页:版本信息 / 后台日志入口(纯展示) */
export function SettingsAbout({ appVersion }: { appVersion: string | null }): React.JSX.Element {
  return (
    <div className="cfg-pane">
      <div className="cfg-panel">
        {/* 版本串挂在行名下的说明位(等宽),右侧不摆控件 */}
        <CfgRow
          label="版本"
          hint={
            <span className="mono cfg-version">
              CodeAtlas {appVersion ?? '…'} · Electron {window.atlas.versions.electron()} · Node{' '}
              {window.atlas.versions.node()} · Chromium {window.atlas.versions.chrome()}
            </span>
          }
        />
        <div className="cfg-divider" />
        <CfgRow label="后台日志" hint="查看引擎运行日志与请求记录。">
          <button type="button" className="cfg-btn" onClick={() => void window.atlas.devLogsOpen()}>
            <TreeIcon name="monitor" size={13} mono />
            打开后台日志
          </button>
        </CfgRow>
      </div>
    </div>
  )
}
