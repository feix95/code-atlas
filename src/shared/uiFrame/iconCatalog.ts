// 图标目录(M3-e):lucide 名字的分类归桶、中文别名到英文关键词的映射、统一搜索。
// 纯数据层:渲染层的 IconPicker 与自测共用;别名表是「够用就行的常用词面」,
// 覆盖高频 UI 场景,搜不到时提示换英文关键词(不追求全量对照表)。

/** 分类:按名字前缀/关键词归桶;match 为包含匹配的片段表 */
export interface IconCategory {
  id: string
  label: string
  keywords: string[]
}

export const ICON_CATEGORIES: IconCategory[] = [
  {
    id: 'arrow',
    label: '箭头',
    keywords: [
      'arrow',
      'chevron',
      'corner',
      'move',
      'undo',
      'redo',
      'reply',
      'share-2',
      'external-link'
    ]
  },
  {
    id: 'ui',
    label: '界面',
    keywords: [
      'menu',
      'panel',
      'sidebar',
      'layout',
      'grid',
      'columns',
      'rows',
      'square',
      'circle',
      'frame',
      'layers',
      'box',
      'component',
      'align',
      'separator',
      'table'
    ]
  },
  {
    id: 'edit',
    label: '编辑',
    keywords: [
      'pen',
      'pencil',
      'edit',
      'trash',
      'delete',
      'copy',
      'clipboard',
      'save',
      'plus',
      'minus',
      'x',
      'check',
      'wand',
      'brush',
      'paint',
      'eraser',
      'type',
      'text',
      'bold',
      'italic',
      'list'
    ]
  },
  {
    id: 'file',
    label: '文件',
    keywords: [
      'file',
      'folder',
      'archive',
      'book',
      'notebook',
      'sticky-note',
      'paperclip',
      'printer',
      'download',
      'upload',
      'import',
      'export'
    ]
  },
  {
    id: 'device',
    label: '设备',
    keywords: [
      'monitor',
      'smartphone',
      'laptop',
      'tablet',
      'keyboard',
      'mouse',
      'printer',
      'camera',
      'mic',
      'speaker',
      'battery',
      'wifi',
      'bluetooth',
      'usb',
      'plug',
      'power',
      'server',
      'cpu',
      'hard-drive'
    ]
  },
  {
    id: 'media',
    label: '媒体',
    keywords: [
      'play',
      'pause',
      'music',
      'video',
      'image',
      'photo',
      'film',
      'volume',
      'skip',
      'repeat',
      'shuffle',
      'radio',
      'podcast'
    ]
  },
  {
    id: 'people',
    label: '人物',
    keywords: ['user', 'users', 'person', 'smile', 'baby', 'accessibility', 'hand', 'thumbs']
  },
  {
    id: 'comm',
    label: '通讯',
    keywords: ['mail', 'message', 'chat', 'phone', 'send', 'at-sign', 'bell', 'inbox']
  },
  {
    id: 'status',
    label: '状态',
    keywords: [
      'alert',
      'info',
      'help',
      'circle-help',
      'check-circle',
      'x-circle',
      'ban',
      'flag',
      'star',
      'heart',
      'bookmark',
      'award',
      'trophy',
      'thumbs-up',
      'eye',
      'lock',
      'unlock',
      'key',
      'shield',
      'verified',
      'badge'
    ]
  },
  {
    id: 'time',
    label: '时间',
    keywords: ['clock', 'calendar', 'timer', 'hourglass', 'watch', 'alarm', 'history']
  },
  {
    id: 'biz',
    label: '商业',
    keywords: [
      'shopping',
      'cart',
      'credit-card',
      'wallet',
      'banknote',
      'coins',
      'receipt',
      'tag',
      'gift',
      'package',
      'truck',
      'store',
      'barcode',
      'qr'
    ]
  },
  {
    id: 'nav',
    label: '导航',
    keywords: [
      'home',
      'map',
      'compass',
      'navigation',
      'locate',
      'globe',
      'anchor',
      'signpost',
      'milestone',
      'route'
    ]
  },
  {
    id: 'tool',
    label: '工具',
    keywords: [
      'settings',
      'gear',
      'wrench',
      'hammer',
      'screwdriver',
      'tool',
      'search',
      'filter',
      'sliders',
      'toggle',
      'gauge',
      'terminal',
      'code',
      'bug',
      'flask'
    ]
  },
  {
    id: 'weather',
    label: '自然',
    keywords: [
      'sun',
      'moon',
      'cloud',
      'star',
      'zap',
      'flame',
      'droplet',
      'snowflake',
      'wind',
      'leaf',
      'tree',
      'flower',
      'mountain'
    ]
  },
  { id: 'misc', label: '其他', keywords: [] }
]

/** 名字的所属分类(第一个命中的桶;都不中进「其他」) */
export function iconCategory(name: string): string {
  for (const c of ICON_CATEGORIES) {
    if (c.id === 'misc') continue
    if (
      c.keywords.some(
        (k) =>
          name === k ||
          name.startsWith(`${k}-`) ||
          name.includes(`-${k}-`) ||
          name.endsWith(`-${k}`)
      )
    ) {
      return c.id
    }
  }
  return 'misc'
}

/** 中文别名 → lucide 名关键词(含在名字里即算命中) */
export const ICON_ZH: Record<string, string[]> = {
  搜索: ['search'],
  设置: ['settings', 'gear', 'sliders'],
  齿轮: ['settings', 'gear'],
  用户: ['user'],
  账户: ['user', 'circle-user'],
  人: ['user', 'users'],
  箭头: ['arrow'],
  返回: ['arrow-left', 'undo', 'reply'],
  前进: ['arrow-right', 'redo'],
  向上: ['arrow-up', 'chevron-up'],
  向下: ['arrow-down', 'chevron-down'],
  向左: ['arrow-left', 'chevron-left'],
  向右: ['arrow-right', 'chevron-right'],
  关闭: ['x', 'x-circle'],
  打开: ['external-link', 'unlock'],
  菜单: ['menu', 'ellipsis'],
  更多: ['ellipsis', 'more-horizontal'],
  删除: ['trash', 'x'],
  编辑: ['pencil', 'pen', 'edit'],
  保存: ['save'],
  复制: ['copy', 'clipboard'],
  粘贴: ['clipboard'],
  加: ['plus'],
  新增: ['plus', 'circle-plus'],
  减: ['minus'],
  对勾: ['check'],
  完成: ['check', 'check-circle'],
  星: ['star'],
  收藏: ['star', 'bookmark'],
  书签: ['bookmark'],
  心: ['heart'],
  喜欢: ['heart', 'thumbs-up'],
  点赞: ['thumbs-up'],
  眼睛: ['eye'],
  隐藏: ['eye-off'],
  锁: ['lock'],
  解锁: ['unlock'],
  钥匙: ['key'],
  通知: ['bell'],
  提醒: ['bell', 'alarm'],
  消息: ['message', 'mail'],
  邮件: ['mail'],
  聊天: ['message-circle', 'message-square'],
  评论: ['message-circle'],
  电话: ['phone'],
  发送: ['send'],
  分享: ['share', 'share-2'],
  链接: ['link', 'link-2'],
  二维码: ['qr-code'],
  下载: ['download'],
  上传: ['upload'],
  文件: ['file'],
  文件夹: ['folder'],
  图片: ['image', 'photo'],
  相册: ['image', 'images'],
  播放: ['play'],
  暂停: ['pause'],
  停止: ['square', 'circle-stop'],
  音乐: ['music'],
  视频: ['video'],
  音量: ['volume'],
  相机: ['camera'],
  麦克风: ['mic'],
  时间: ['clock'],
  时钟: ['clock', 'watch'],
  日历: ['calendar'],
  定时: ['timer', 'alarm'],
  位置: ['map-pin', 'locate'],
  地图: ['map'],
  家: ['home', 'house'],
  首页: ['home', 'house'],
  购物: ['shopping'],
  购物车: ['shopping-cart', 'shopping-bag'],
  支付: ['credit-card', 'wallet'],
  钱包: ['wallet'],
  价格: ['tag', 'receipt'],
  警告: ['alert-triangle', 'alert-circle', 'triangle-alert'],
  错误: ['x-circle', 'circle-x'],
  成功: ['check-circle', 'circle-check'],
  信息: ['info', 'circle-alert'],
  帮助: ['help-circle', 'circle-help'],
  刷新: ['refresh', 'rotate', 'loader'],
  加载: ['loader', 'loader-circle'],
  排序: ['arrow-up-down', 'list-filter'],
  筛选: ['filter', 'list-filter'],
  拖拽: ['grip', 'move'],
  展开: ['chevrons-up-down', 'unfold', 'maximize'],
  收起: ['fold', 'minimize'],
  全屏: ['maximize', 'expand'],
  最小化: ['minimize', 'minus'],
  打印: ['printer'],
  终端: ['terminal', 'square-terminal'],
  代码: ['code', 'code-2'],
  电池: ['battery'],
  无线: ['wifi'],
  蓝牙: ['bluetooth'],
  电源: ['power'],
  屏幕: ['monitor', 'smartphone'],
  手机: ['smartphone'],
  电脑: ['monitor', 'laptop'],
  日历视图: ['calendar-days', 'calendar-range']
}

/** 是否有中日韩字符(决定走别名扩展还是纯英文匹配) */
const HAS_CJK = /[一-鿿]/

/**
 * 统一搜索:中文词先过别名表扩成英文关键词集,再对名字与标签做包含匹配;
 * 英文/数字原样小写匹配名字与 lucide 标签。
 */
export function iconSearch(
  query: string,
  names: string[],
  tagsFor: (name: string) => string[]
): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return names
  const words = HAS_CJK.test(q) ? (ICON_ZH[q] ?? []) : []
  // 中文词也允许「部分别名」命中:输入「返回」也能带上 arrow-left 之类
  for (const [zh, kws] of Object.entries(ICON_ZH)) {
    if (HAS_CJK.test(q) && zh.includes(q)) words.push(...kws)
  }
  if (HAS_CJK.test(q) && words.length === 0) return []
  const hit = (name: string): boolean =>
    HAS_CJK.test(q)
      ? words.some(
          (k) => name.includes(k) || tagsFor(name).some((t) => t.toLowerCase().includes(k))
        )
      : name.includes(q) || tagsFor(name).some((t) => t.toLowerCase().includes(q))
  return names.filter(hit)
}
