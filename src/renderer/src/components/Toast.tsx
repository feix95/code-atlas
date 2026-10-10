// 通用轻提示(全场唯一出口):底部居中的短句,自己消失,不抢焦点、不吃鼠标。
// 常驻的 aria-live 区域保证读屏软件能播报新消息;视觉样式全走 toast.css 的 token。
import type { ToastState } from '../useToast'

export function Toast({ toast }: { toast: ToastState | null }): React.JSX.Element {
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {toast && (
        <div key={toast.id} className="toast">
          {toast.text}
        </div>
      )}
    </div>
  )
}
