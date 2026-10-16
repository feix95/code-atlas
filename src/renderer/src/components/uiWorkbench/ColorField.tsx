// 属性面板通用颜色框:色板(系统取色器)+ hex 文本输入;填充色与描边色共用。
// 取色器拖动 = 连续 input 事件:首帧起批(beginBatch)逐帧 onCommit 让画布实时预览;
// change(确认关闭)/cancel(Esc 取消——浏览器已还原原值,提交即预览回滚、批内净零)
// 时结算成一笔撤销——预览过程不刷历史。
// 文本框行为与 NumberField 对齐:回车提交并交还焦点,Esc 还原,非法输入还原为当前值;
// # 可省、3 位扩 6 位、统一小写,解析由 parseHexColor 收口。
import { useEffect, useRef } from 'react'
import { parseHexColor } from '@shared/uiWorkbench/node'
import { docActions } from '../../uiWorkbench/documentStore'

export function ColorField({
  label,
  value,
  onCommit
}: {
  label: string
  /** 6 位小写 hex */
  value: string
  onCommit: (hex: string) => void
}): React.JSX.Element {
  const swatchRef = useRef<HTMLInputElement | null>(null)
  /** 取色器开着 = 预览批次开着;挂载期存活,卸载兜底结算 */
  const pickingRef = useRef(false)
  // onCommit 是每渲染新建的内联函数,存 ref 让监听只挂一次;预览逐帧派发也不会抖动
  const onCommitRef = useRef(onCommit)
  useEffect(() => {
    onCommitRef.current = onCommit
  }, [onCommit])

  // 取色期间的色板不能重挂(重挂会拆掉原生弹窗):非受控 + 非取色时才同步外部值
  useEffect(() => {
    const swatch = swatchRef.current
    if (swatch && !pickingRef.current && swatch.value !== value) swatch.value = value
  }, [value])

  // 组件卸载(如改选中)而取色器还开着:必须把挂起批次结掉,否则后续 dispatch 全被吸进死批次
  useEffect(
    () => () => {
      if (pickingRef.current) {
        pickingRef.current = false
        docActions.endBatch()
      }
    },
    []
  )

  useEffect(() => {
    const swatch = swatchRef.current
    if (!swatch) return
    const win = swatch.ownerDocument.defaultView
    const stopPicking = (): void => {
      pickingRef.current = false
      win?.removeEventListener('blur', stopPicking)
      docActions.endBatch()
    }
    const preview = (): void => {
      if (!pickingRef.current) {
        pickingRef.current = true
        // 窗口失焦 = 取色器被异常关闭(不发 change):兜底结算,批次不挂起
        win?.addEventListener('blur', stopPicking, { once: true })
        docActions.beginBatch()
      }
      onCommitRef.current(swatch.value)
    }
    const finish = (): void => {
      if (pickingRef.current) {
        // 末值也进批次再结算:整段挑色 = 一步撤销
        onCommitRef.current(swatch.value)
        stopPicking()
      } else {
        onCommitRef.current(swatch.value)
      }
    }
    swatch.addEventListener('input', preview)
    swatch.addEventListener('change', finish)
    // Esc 取消取色器不发 change 只发 cancel:漏了它批次永久挂起、撤销全死;
    // 取消时浏览器已把值还原成取色前原值,提交它 = 预览回滚 + 批内净零不入账
    swatch.addEventListener('cancel', finish)
    return () => {
      swatch.removeEventListener('input', preview)
      swatch.removeEventListener('change', finish)
      swatch.removeEventListener('cancel', finish)
    }
  }, [])

  function commit(input: HTMLInputElement): void {
    const parsed = parseHexColor(input.value)
    input.value = parsed ?? value
    if (parsed !== null && parsed !== value) onCommit(parsed)
  }

  return (
    <span className="uwb-field">
      <input
        ref={swatchRef}
        type="color"
        className="uwb-swatch"
        defaultValue={value}
        aria-label={`${label}取色`}
      />
      <input
        key={value}
        className="cfg-input uwb-input"
        defaultValue={value}
        aria-label={label}
        spellCheck={false}
        onBlur={(e) => commit(e.currentTarget)}
        onKeyDown={(e) => {
          // 回车提交后交出焦点:焦点留在框内时 Ctrl+Z 是输入框的文字撤销,
          // 交出去才能让工作台的文档撤销接管(Figma 同款交互)
          if (e.key === 'Enter') {
            commit(e.currentTarget)
            e.currentTarget.blur()
          } else if (e.key === 'Escape') e.currentTarget.value = value
        }}
      />
    </span>
  )
}
