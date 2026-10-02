// 立项问卷(§3)的数据结构总账:题目、答案、推导规则、立项单。
// 与 uiFrame/ 同级:问卷是「第一步」,UI 框架是「第二步」,两边只通过预填结果衔接。
// 全部为纯类型 + 纯函数,渲染层与自测共用这一份定义。

/** 分组 id(§3.3 的 A~G) */
export type QuizGroupId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G'

export type QuestionKind = 'single' | 'multi' | 'text'

export interface QuizOption {
  id: string
  label: string
}

export interface QuizQuestion {
  /** 题号('A1'…'G4'),与 §3.3 表格一致 */
  id: string
  group: QuizGroupId
  title: string
  kind: QuestionKind
  options: QuizOption[]
  /** 题下补充说明(如 B1 选「游戏」时的引擎提示) */
  note?: string
  /** 条件显隐(§3.2):缺省=始终显示;返回 false 的题不呈现也不计入进度 */
  visibleIf?: (answers: AnswerMap) => boolean
  /** text 题专用:输入占位提示 */
  placeholder?: string
}

/** 一题的作答;「让 AI 建议」单独一种,不与其他选项混选(§3.2) */
export type QuizAnswer =
  | { kind: 'options'; ids: string[]; extra?: string }
  | { kind: 'text'; text: string }
  | { kind: 'ai' }

/** 键 = 题号 */
export type AnswerMap = Record<string, QuizAnswer>

/** 推导规则(§3.4):条件命中 → 约束文案写进立项单;整张表是配置,新规则只加行 */
export interface QuizRule {
  id: string
  when: (answers: AnswerMap) => boolean
  constraint: string
}

/** 立单生成入参 */
export interface BriefInput {
  answers: AnswerMap
  /** 产品名,可空 */
  productName?: string
  /** 填写日期(yyyy-mm-dd);缺省取当天 */
  date?: string
}

/** 立项单存盘结果(§3.6 路径一) */
export type QuizBriefSaveResult = { status: 'canceled' } | { status: 'done'; path: string }
