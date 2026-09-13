/**
 * 页签品类(小葵的页签模型):右栏的一张页签,要么是概览、要么是 Atlas 小探针(自由对话)、
 * 要么是文件预览 —— 一个文件/文件夹最多摊开这三张。以后出新功能页,这里加品类。
 * 判断「某节点能开哪几种页签」走两层过滤(小葵定的架构,别混一层):
 * 第一层 KIND_CAPS 按节点类型卡上限(文件有预览,文件夹/项目根没有);
 * 第二层 KINDS_KEY 的显示开关在上限里挑真正显示的 —— 以后加新节点类型只动第一层。
 */
export type PaneKind = 'overview' | 'chat' | 'preview'

/** 品类的固定展示顺序(页签栏右键菜单从上到下按这个排) */
export const KIND_ORDER: PaneKind[] = ['overview', 'chat', 'preview']

export const KIND_LABELS: Record<PaneKind, string> = {
  overview: '概览',
  chat: 'Atlas 小探针',
  preview: '文件预览'
}

/** 跟随页签的门面:页签栏挂品类名牌(装着谁看正文头部),图标从图标册领 */
export const KIND_ICONS: Record<PaneKind, string> = {
  overview: 'bulb',
  chat: 'bot',
  preview: 'code'
}

/** 第一层过滤:节点类型 → 可用品类上限 */
export const KIND_CAPS: Record<'file' | 'directory', PaneKind[]> = {
  file: ['overview', 'chat', 'preview'],
  directory: ['overview', 'chat']
}

/**
 * 跟随型品类:这些页签是「当前选中对象的常驻窗口」,勾着显示就该在栏上 ——
 * 被 × 掉了,树里一动就自动补回来(装着新对象)。文件预览是按需品类(双击/绿字才开),
 * 不在其列,被关了就安安静静等用户点名。
 */
export const FOLLOW_KINDS: PaneKind[] = ['overview', 'chat']

/** 第二层过滤:哪些品类勾选显示,记进本机(跨重启记住自己的勾法) */
const KINDS_KEY = 'atlas.pane-kinds'

export function loadEnabledKinds(): Set<PaneKind> {
  try {
    const raw = localStorage.getItem(KINDS_KEY)
    if (raw) {
      const list = JSON.parse(raw) as string[]
      const valid = KIND_ORDER.filter((k) => list.includes(k))
      if (list.length > 0) return new Set(valid)
    }
  } catch {
    // 存档坏了就当没存过,回到出厂全开
  }
  return new Set(KIND_ORDER)
}

export function saveEnabledKinds(kinds: Set<PaneKind>): void {
  localStorage.setItem(KINDS_KEY, JSON.stringify(KIND_ORDER.filter((k) => kinds.has(k))))
}
