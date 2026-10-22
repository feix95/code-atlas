// AI 状态的读数与动作:三态脸、字节账、头部结论文案、内置模型装卸 —— 纯映射,不碰渲染。
import type { AiConfig, ModelStatus } from '@shared/types'
import { PROVIDER_OPTIONS } from '@shared/aiSetup'
import { findCloudVendor } from '@shared/cloudVendors'

/** 状态脸:三态外的第四态 = 红插头(出错 = 红 unplug) */
export type AiFace = 'ready' | 'loading' | 'idle' | 'error'

export function faceOf(configured: boolean | null | undefined, status: ModelStatus | null): AiFace {
  if (configured !== true || !status) return 'idle'
  if (status.state === 'loading') return 'loading'
  if (status.state === 'ready' || status.state === 'busy') return 'ready'
  if (status.state === 'error' || status.state === 'unreachable') return 'error'
  return 'idle'
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes <= 0) return ''
  const gb = bytes / 1024 ** 3
  if (gb >= 1) return `${gb.toFixed(2)} GB`
  const mb = bytes / 1024 ** 2
  if (mb >= 1) return `${Math.round(mb)} MB`
  return `${bytes} 字节`
}

/** 浮层「换模型」快捷道:弹 GGUF 文件框 → 读配置改路径 → 存档
    (存档 handler 自带「换模型就地解散旧引擎」逻辑,状态播报自动刷) */
export async function switchModelFile(): Promise<void> {
  const picked = await window.atlas.aiPickFile().catch(() => null)
  if (!picked) return
  const config = await window.atlas.aiConfigGet().catch(() => null)
  if (!config) return
  await window.atlas
    .aiConfigSave({ ...config, builtin: { ...config.builtin, modelPath: picked } })
    .catch(() => {})
}

/** 一次「测试连接」的结论:busy=正在问,ok=服务商回了名单,fail=报人话错 */
export type Probe = { kind: 'busy' | 'ok' | 'fail'; text: string }

/** 头部视图:圆点只做四色助理(绿=可用/蓝=进行中/红=异常/灰=未启用),
    真值由状态词担——在线 API 底层报「就绪」只代表配置填全,从没真连过,
    翻译成「已配置」+灰点;本会话测过了才按测试结论改口(就绪绿/没连上红) */
export function headView(
  status: ModelStatus,
  probe: Probe | null
): {
  dot: 'ok' | 'go' | 'bad' | 'off'
  text: string
  tip?: string
} {
  if (status.provider === 'cloud' && status.state === 'ready') {
    if (probe?.kind === 'ok') return { dot: 'ok', text: '就绪' }
    if (probe?.kind === 'fail') return { dot: 'bad', text: '未连接' }
    return {
      dot: 'off',
      text: '已配置',
      tip: '配置已填写,尚未测试连接'
    }
  }
  switch (status.state) {
    case 'loading':
      return {
        dot: 'go',
        text:
          status.progress === null
            ? '热身中……'
            : `热身中 ${status.estimated ? '约 ' : ''}${Math.round(status.progress)}%`,
        tip: status.estimated ? '进度为估算值' : undefined
      }
    case 'busy':
      return { dot: 'go', text: '处理中' }
    case 'ready':
      return { dot: 'ok', text: '就绪' }
    case 'idle':
      return { dot: 'off', text: '未装载' }
    case 'unreachable':
      return { dot: 'bad', text: '未连接' }
    default:
      return { dot: 'bad', text: '出错' }
  }
}

/** 内置模型的装卸动作:热身中=取消,就绪=卸下,没叫醒/出岔子/连不上=装载主动热身;
    外接的装卸归 LM Studio 管,这里不出钮 */
export function builtinAct(
  status: ModelStatus
): { label: string; tip: string; run: () => void } | null {
  if (status.provider !== 'builtin' || status.state === 'busy') return null
  if (status.state === 'loading')
    return { label: '取消', tip: '取消本次装载', run: () => void window.atlas.modelEject() }
  if (status.state === 'ready')
    return { label: '卸下', tip: '卸载模型,释放显存', run: () => void window.atlas.modelEject() }
  return { label: '装载', tip: '装载模型到内存', run: () => void window.atlas.modelLoad() }
}

/** 浮层里的供应商真名:在线 API 取厂商预设的短名,内置/外接取档位登记 */
export function providerNameOf(status: ModelStatus, cfg: AiConfig | null): string {
  if (status.provider !== 'cloud') {
    return PROVIDER_OPTIONS.find((p) => p.id === status.provider)?.label ?? status.provider
  }
  const short = cfg ? (findCloudVendor(cfg.cloud.vendor)?.label.split('(')[0] ?? '自定义') : '…'
  return `在线 API · ${short}`
}
