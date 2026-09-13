import { Component, type ErrorInfo, type ReactNode } from 'react'

interface BoundaryProps {
  /** 出事时垫给用户看的人话:说清「坏了多大一块、怎么补救」 */
  note: string
  /** 给「就地重试」按钮的话:点了清掉兜底状态重画子树;不传就不给按钮 */
  retryLabel?: string
  /** 给「整页重挂」按钮的话:点了 reload 整页;给顶层网用 —— 子树重画大概率还崩,整页才干净 */
  reloadLabel?: string
  /** top = 顶层网:占窗口居中的一整块(样式另配);不传 = 消息级小卡 */
  variant?: 'top'
  children: ReactNode
}

interface BoundaryState {
  broken: boolean
}

/** 渲染期崩溃的兜底网(2026-09-13 隐身案第二课)。
 * 以前任何一个组件渲染炸了,React 就把整棵树卸了 —— 透明窗一白屏就是整窗隐身,
 * 用户连「程序还在」都看不出来。现在每一层网接住自己范围的错:窗还在、话说明白、
 * 能就地重试;错误原样上报后台账本,根因照追不误。 */
export class ErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { broken: false }

  static getDerivedStateFromError(): Partial<BoundaryState> {
    return { broken: true }
  }

  componentDidCatch(err: Error, info: ErrorInfo): void {
    const where = info.componentStack?.trim().split('\n')[0]?.trim() ?? '位置不明'
    window.atlas?.reportRendererError(`渲染兜底网接住:${err.name}:${err.message} @ ${where}`)
  }

  private retry = (): void => {
    this.setState({ broken: false })
  }

  private reload = (): void => {
    window.location.reload()
  }

  render(): ReactNode {
    if (!this.state.broken) return this.props.children
    return (
      <div className={`err-boundary${this.props.variant === 'top' ? ' is-top' : ''}`} role="alert">
        <p>{this.props.note}</p>
        <div className="err-boundary-actions">
          {this.props.retryLabel && (
            <button type="button" onClick={this.retry}>
              {this.props.retryLabel}
            </button>
          )}
          {this.props.reloadLabel && (
            <button type="button" onClick={this.reload}>
              {this.props.reloadLabel}
            </button>
          )}
        </div>
      </div>
    )
  }
}
