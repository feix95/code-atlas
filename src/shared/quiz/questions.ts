// 题目全集(§3.3):A~G 七组,每题自带条件显隐谓词;选项 id 稳定,推导规则靠它判断。
// 「让 AI 建议」不在 options 里,界面层对每题统一追加该项(§3.2)。

import type { AnswerMap, QuizGroupId, QuizOption, QuizQuestion } from './types.ts'

const opts = (pairs: Array<[string, string]>): QuizOption[] =>
  pairs.map(([id, label]) => ({ id, label }))

/** A1 里含某平台,供条件显隐与推导规则共用 */
const picked = (answers: AnswerMap, qid: string, ...ids: string[]): boolean => {
  const a = answers[qid]
  return a?.kind === 'options' && ids.some((id) => a.ids.includes(id))
}

/** 手机或平板都算「移动端」,A3 系统题对两者显示(§3.2 例) */
const hasMobile = (answers: AnswerMap): boolean => picked(answers, 'A1', 'phone', 'tablet')
const hasDesktop = (answers: AnswerMap): boolean => picked(answers, 'A1', 'desktop')
const hasPhone = (answers: AnswerMap): boolean => picked(answers, 'A1', 'phone')

export interface QuizGroup {
  id: QuizGroupId
  title: string
}

export const QUIZ_GROUPS: QuizGroup[] = [
  { id: 'A', title: '平台与设备' },
  { id: 'B', title: '产品品类' },
  { id: 'C', title: '用户与规模' },
  { id: 'D', title: '功能形态' },
  { id: 'E', title: '数据与合规' },
  { id: 'F', title: '资源与约束' },
  { id: 'G', title: '视觉偏好' }
]

export const QUESTIONS: QuizQuestion[] = [
  // ── A 组 · 平台与设备 ──
  {
    id: 'A1',
    group: 'A',
    title: '运行在哪里',
    kind: 'multi',
    options: opts([
      ['desktop', '电脑桌面应用'],
      ['phone', '手机 app'],
      ['tablet', '平板'],
      ['web', '网页(浏览器打开)'],
      ['miniprogram', '微信小程序']
    ])
  },
  {
    id: 'A2',
    group: 'A',
    title: '电脑端系统',
    kind: 'multi',
    options: opts([
      ['win', 'Windows'],
      ['mac', 'macOS'],
      ['linux', 'Linux']
    ]),
    visibleIf: hasDesktop
  },
  {
    id: 'A3',
    group: 'A',
    title: '手机端系统',
    kind: 'multi',
    options: opts([
      ['ios', 'iOS'],
      ['android', 'Android'],
      ['harmony', '鸿蒙(HarmonyOS)']
    ]),
    visibleIf: hasMobile
  },
  {
    id: 'A4',
    group: 'A',
    title: '屏幕方向(手机)',
    kind: 'single',
    options: opts([
      ['portrait', '只竖屏'],
      ['landscape', '只横屏'],
      ['both', '两者都支持']
    ]),
    visibleIf: hasPhone
  },
  {
    id: 'A5',
    group: 'A',
    title: '离线使用',
    kind: 'single',
    options: opts([
      ['offline', '必须能完全离线'],
      ['sometimes', '偶尔联网'],
      ['online', '必须在线']
    ])
  },

  // ── B 组 · 产品品类 ──
  {
    id: 'B1',
    group: 'B',
    title: '产品品类',
    kind: 'single',
    options: opts([
      ['productivity', '效率工具'],
      ['devtools', '开发者工具'],
      ['creative', '创作与设计'],
      ['notes', '笔记与知识管理'],
      ['education', '教育学习'],
      ['life', '生活服务'],
      ['health', '健康健身'],
      ['social', '社交通讯'],
      ['content', '内容资讯与阅读'],
      ['media', '视频音乐娱乐'],
      ['ecommerce', '电商购物'],
      ['finance', '金融理财与记账'],
      ['travel', '出行旅游'],
      ['food', '美食'],
      ['game', '游戏'],
      ['enterprise', '企业办公与管理后台'],
      ['iot', '智能硬件控制'],
      ['ai-app', 'AI 应用'],
      ['other', '其他']
    ]),
    note: '选「游戏」时:游戏画面通常由游戏引擎(如 Unity、Godot)绘制,第二步只覆盖游戏内的菜单、设置、HUD 等常规界面,不覆盖游戏画面本身'
  },
  {
    id: 'B2',
    group: 'B',
    title: '一句话描述',
    kind: 'text',
    options: [],
    placeholder: '例:帮健身新手记录力量训练组数的计时器(可不填)'
  },

  // ── C 组 · 用户与规模 ──
  {
    id: 'C1',
    group: 'C',
    title: '谁会用',
    kind: 'single',
    options: opts([
      ['self', '只有自己'],
      ['circle', '朋友或小圈子'],
      ['niche', '特定人群(如学生、店主)'],
      ['public', '公开给所有人']
    ])
  },
  {
    id: 'C2',
    group: 'C',
    title: '预期规模',
    kind: 'single',
    options: opts([
      ['one', '1 人'],
      ['lt100', '100 人以内'],
      ['lt10k', '1 万人以内'],
      ['gt10k', '1 万人以上']
    ])
  },
  {
    id: 'C3',
    group: 'C',
    title: '发布方式',
    kind: 'multi',
    options: opts([
      ['self', '只自己用'],
      ['distribute', '发安装包给别人'],
      ['store', '上架应用商店'],
      ['web', '网站上线']
    ])
  },
  {
    id: 'C4',
    group: 'C',
    title: '上线地区',
    kind: 'multi',
    options: opts([
      ['cn', '中国大陆'],
      ['overseas', '海外']
    ])
  },

  // ── D 组 · 功能形态 ──
  {
    id: 'D1',
    group: 'D',
    title: '账号登录',
    kind: 'single',
    options: opts([
      ['none', '不需要'],
      ['local-lock', '本地密码锁'],
      ['email', '邮箱或手机号注册'],
      ['third-party', '第三方登录(微信、Apple、Google)']
    ])
  },
  {
    id: 'D2',
    group: 'D',
    title: '数据存哪',
    kind: 'single',
    options: opts([
      ['local', '只存本机'],
      ['sync', '多设备同步'],
      ['shared', '多人共享同一份数据']
    ])
  },
  {
    id: 'D3',
    group: 'D',
    title: '实时性',
    kind: 'multi',
    options: opts([
      ['none', '不需要'],
      ['push', '消息推送通知'],
      ['realtime', '实时聊天或多人协作']
    ])
  },
  {
    id: 'D4',
    group: 'D',
    title: '收费方式',
    kind: 'single',
    options: opts([
      ['free', '免费'],
      ['paid', '一次性买断'],
      ['subscription', '订阅'],
      ['iap', '应用内购买'],
      ['ecommerce', '电商交易(卖实物或服务)']
    ])
  },
  {
    id: 'D5',
    group: 'D',
    title: '文件与媒体',
    kind: 'multi',
    options: opts([
      ['none', '无'],
      ['image', '图片'],
      ['audio', '音频'],
      ['video', '视频'],
      ['large', '大文件上传下载']
    ])
  },
  {
    id: 'D6',
    group: 'D',
    title: 'AI 能力',
    kind: 'single',
    options: opts([
      ['none', '不需要'],
      ['cloud', '调用云端大模型'],
      ['local', '本机运行模型']
    ])
  },
  {
    id: 'D7',
    group: 'D',
    title: '设备能力',
    kind: 'multi',
    options: opts([
      ['none', '无'],
      ['location', '定位与地图'],
      ['camera', '摄像头扫码'],
      ['ble', '蓝牙或传感器'],
      ['notify', '本地通知提醒']
    ])
  },
  {
    id: 'D8',
    group: 'D',
    title: '界面语言',
    kind: 'single',
    options: opts([
      ['zh', '只中文'],
      ['en', '只英文'],
      ['multi', '多语言']
    ])
  },
  {
    id: 'D9',
    group: 'D',
    title: '无障碍需求',
    kind: 'single',
    options: opts([
      ['normal', '常规即可'],
      ['enhanced', '需要重点照顾(老年人、视障用户)']
    ])
  },

  // ── E 组 · 数据与合规 ──
  {
    id: 'E1',
    group: 'E',
    title: '数据敏感度',
    kind: 'multi',
    options: opts([
      ['normal', '普通数据'],
      ['pii', '个人信息(姓名、手机号)'],
      ['finance', '金融数据'],
      ['health', '健康数据'],
      ['minor', '涉及未成年人']
    ])
  },

  // ── F 组 · 资源与约束 ──
  {
    id: 'F1',
    group: 'F',
    title: '预算',
    kind: 'single',
    options: opts([
      ['zero', '必须零成本'],
      ['low', '每月少量服务器费用可接受'],
      ['invest', '可投入']
    ])
  },
  {
    id: 'F2',
    group: 'F',
    title: '时间预期',
    kind: 'single',
    options: opts([
      ['try', '尝鲜试做'],
      ['weeks', '几周内出雏形'],
      ['longterm', '长期维护的产品']
    ])
  },
  {
    id: 'F3',
    group: 'F',
    title: '谁来维护',
    kind: 'single',
    options: opts([
      ['self-ai', '自己 + AI'],
      ['programmer', '有程序员参与']
    ])
  },
  {
    id: 'F4',
    group: 'F',
    title: '你的技能',
    kind: 'single',
    options: opts([
      ['none', '完全不会代码'],
      ['some', '会一点'],
      ['can', '会写代码']
    ])
  },

  // ── G 组 · 视觉偏好(直接预填第二步)──
  {
    id: 'G1',
    group: 'G',
    title: '风格倾向',
    kind: 'single',
    options: opts([
      ['minimal', '极简中性'],
      ['modern', '现代简洁'],
      ['tinted', '色调圆角'],
      ['soft', '柔和层次'],
      ['airy', '留白清透'],
      ['glass', '毛玻璃'],
      ['neumorphic', '新拟态'],
      ['brutal', '新粗野'],
      ['flat', '扁平']
    ])
  },
  {
    id: 'G2',
    group: 'G',
    title: '亮暗主题',
    kind: 'single',
    options: opts([
      ['light', '只亮色'],
      ['dark', '只暗色'],
      ['both', '两套都要,跟随系统']
    ])
  },
  {
    id: 'G3',
    group: 'G',
    title: '品牌主色',
    kind: 'single',
    options: opts([
      ['have', '已有(下面填色号)'],
      ['recommend', '没有,帮我推荐']
    ])
  },
  {
    id: 'G4',
    group: 'G',
    title: '信息密度',
    kind: 'single',
    options: opts([
      ['roomy', '宽松(大留白)'],
      ['balanced', '适中'],
      ['compact', '紧凑(一屏看更多)']
    ])
  }
]

export const QUESTION_MAP: Record<string, QuizQuestion> = Object.fromEntries(
  QUESTIONS.map((q) => [q.id, q])
)

/** 当前答案下应该显示的题(按组内顺序);条件不满足的题不进流程 */
export function visibleQuestions(answers: AnswerMap): QuizQuestion[] {
  return QUESTIONS.filter((q) => !q.visibleIf || q.visibleIf(answers))
}

/** 按组分组的可见题;组内一道可见题都没有的组跳过 */
export function visibleGroups(
  answers: AnswerMap
): Array<{ group: QuizGroup; questions: QuizQuestion[] }> {
  const visible = visibleQuestions(answers)
  return QUIZ_GROUPS.map((group) => ({
    group,
    questions: visible.filter((q) => q.group === group.id)
  })).filter((g) => g.questions.length > 0)
}

/** 选项显示名;ai 答案与未作答走界面层文案 */
export function optionLabel(qid: string, optionId: string): string {
  const q = QUESTION_MAP[qid]
  return q?.options.find((o) => o.id === optionId)?.label ?? optionId
}
