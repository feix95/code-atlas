// 研究计划表:模型首轮自报「这题要查几块」,程序按字段算最低查证量,交卷前对账。
// 判档权仍在模型手里 —— 程序只执行它自己填的数,不按关键词判该不该搜。
import { TAG } from '../shared/promptTags.ts'
import { TOOL_NAMES } from '../shared/agentTools.ts'
import { wrapToolResult } from './agentBudget.ts'
import { AGENT_RESEARCH_GATE_PREFIX } from './agentGuard.ts'

export type ResearchDepth = 'none' | 'quick' | 'normal' | 'deep'

/** 模型填的研究计划:字段名与首轮计划表工具一致 */
export interface ResearchPlan {
  parts: string[]
  mayChange: boolean
  stakesHigh: boolean
  asksSources: boolean
  aboutProject: boolean
  depth: ResearchDepth
}

/** 程序按计划算出的最低查证量:联网动作、成功打开的正文、本地文件各至少几次 */
export interface ResearchFloor {
  depth: ResearchDepth
  lookups: number
  fetches: number
  local: number
}

/** 交卷时账本上的实数(联网按执行次数算,正文只认抓到内容的) */
export interface ResearchCounts {
  lookups: number
  fetches: number
  local: number
}

export const RESEARCH_PLAN_MAX_PARTS = 8

/** 补查闸门最多劝几次:再劝不动就放行,搜不到的题不能死循环 */
export const RESEARCH_GATE_MAX_NUDGES = 2

const DEPTH_RANK: Record<ResearchDepth, number> = { none: 0, quick: 1, normal: 2, deep: 3 }
const DEPTH_LABEL: Record<ResearchDepth, string> = {
  none: '直答',
  quick: '快查',
  normal: '常规',
  deep: '深查'
}

/**
 * 首轮强制填的计划表(纯数据,自测覆盖):只在第一轮发给模型,
 * 填完就换回常驻工具表 —— 不占常驻工具说明书的体积。
 */
export const PLAN_RESEARCH_TOOL = {
  type: 'function',
  function: {
    name: TOOL_NAMES.planResearch,
    description: '回答前先填研究计划:把题拆开,程序按你填的定最低查证量。',
    parameters: {
      type: 'object',
      properties: {
        parts: {
          type: 'array',
          items: { type: 'string' },
          description: '要分别查的独立对象(每个产品/项目/仓库/法条/人物一项;同一门语言里的概念不拆)'
        },
        mayChange: {
          type: 'boolean',
          description: '答案会随时间变(版本、价格、政策、职位、谁还在做、最近动态)'
        },
        stakesHigh: {
          type: 'boolean',
          description: '答错代价大(剂量、法律条款、买卖决定、安全操作、不可逆动作)'
        },
        asksSources: { type: 'boolean', description: '用户要研究、全面、最新进展,或明说要来源' },
        aboutProject: { type: 'boolean', description: '问的是当前项目里的代码或实现' },
        depth: {
          type: 'string',
          enum: ['none', 'quick', 'normal', 'deep'],
          description: 'none 直答 / quick 一个点 / normal 对比多对象 / deep 研究'
        }
      },
      required: ['parts', 'mayChange', 'stakesHigh', 'asksSources', 'aboutProject', 'depth']
    }
  }
} as const

/** 计划表参数清洗(纯函数):只认真布尔和合法档位,认不出的按没填处理,不让脏值抬高下限 */
export function parseResearchPlan(args: Record<string, unknown> | null): ResearchPlan | null {
  if (args === null) return null
  const rawParts = Array.isArray(args.parts) ? args.parts : []
  const parts: string[] = []
  for (const raw of rawParts) {
    if (typeof raw !== 'string') continue
    const part = raw.trim().slice(0, 60)
    if (part === '' || parts.includes(part)) continue
    parts.push(part)
    if (parts.length >= RESEARCH_PLAN_MAX_PARTS) break
  }
  const depth = args.depth
  return {
    parts,
    mayChange: args.mayChange === true,
    stakesHigh: args.stakesHigh === true,
    asksSources: args.asksSources === true,
    aboutProject: args.aboutProject === true,
    depth: depth === 'quick' || depth === 'normal' || depth === 'deep' ? depth : 'none'
  }
}

/**
 * 计划 → 最低查证量(纯函数,自测覆盖):模型自报的档只升不降,
 * 任何一条硬信号都会把下限往上顶 —— 想偷懒报 none,字段也会把它拉回来。
 * - 会变/高风险/要来源:至少快查,并打开一次正文;
 * - 两个以上独立对象 + 任一硬信号:常规,每项至少一次;
 * - 要来源且拆出三块以上:研究题,直接按深查准备。
 */
export function floorFromPlan(plan: ResearchPlan): ResearchFloor {
  if (plan.aboutProject) return { depth: 'none', lookups: 0, fetches: 0, local: 1 }
  let depth: ResearchDepth = plan.depth
  const bump = (next: ResearchDepth): void => {
    if (DEPTH_RANK[next] > DEPTH_RANK[depth]) depth = next
  }
  const researched = plan.mayChange || plan.stakesHigh || plan.asksSources
  if (researched) bump('quick')
  if (researched && plan.parts.length >= 2) bump('normal')
  if (plan.asksSources && plan.parts.length >= 3) bump('deep')
  const lookups =
    depth === 'deep'
      ? 8
      : depth === 'normal'
        ? Math.min(8, Math.max(3, plan.parts.length))
        : depth === 'quick'
          ? 1
          : 0
  const fetches =
    depth === 'deep'
      ? 2
      : plan.stakesHigh || depth === 'normal' || (depth === 'quick' && plan.mayChange)
        ? 1
        : 0
  return {
    depth,
    lookups: fetches > 0 ? Math.max(lookups, fetches + 1) : lookups,
    fetches,
    local: 0
  }
}

/** 计划的人话摘要(界面灰字用):问项目时说的是「先翻项目文件」,不是档位名 */
export function researchPlanSummary(floor: ResearchFloor): string {
  return floor.local > 0 ? '先翻项目文件' : DEPTH_LABEL[floor.depth]
}

/** 对账(纯函数):还差哪些;全达标回空数组 */
export function unmetResearchFloor(floor: ResearchFloor, counts: ResearchCounts): string[] {
  const missing: string[] = []
  if (counts.lookups < floor.lookups) missing.push(`联网 ${counts.lookups}/${floor.lookups} 次`)
  if (counts.fetches < floor.fetches) missing.push(`打开原文 ${counts.fetches}/${floor.fetches} 次`)
  if (counts.local < floor.local) missing.push(`翻本地文件 ${counts.local}/${floor.local} 次`)
  return missing
}

export interface ResearchPlanOutcome {
  floor: ResearchFloor | null
  /** 回填给模型的 tool 结果(已包 tool_result) */
  content: string
  /** 界面灰字 */
  step: string
}

/** 执行一次计划表调用(纯函数):读不懂就明说,不硬造下限 */
export function runResearchPlanCall(args: Record<string, unknown> | null): ResearchPlanOutcome {
  const plan = parseResearchPlan(args)
  if (!plan) {
    return {
      floor: null,
      content: wrapToolResult('计划表没读懂(参数不是合法 JSON):按普通节奏回答,该查就查。'),
      step: '研究计划没填成,按普通节奏回答'
    }
  }
  const floor = floorFromPlan(plan)
  const parts = plan.parts.length > 0 ? `,对象:${plan.parts.join('、')}` : ''
  const demand =
    floor.local > 0
      ? '程序要求:先翻项目里的文件至少 1 次再答'
      : floor.lookups > 0
        ? `程序要求:联网至少 ${floor.lookups} 次${floor.fetches > 0 ? `(其中打开正文至少 ${floor.fetches} 次)` : ''},查够再交卷`
        : '程序要求:这题可以直答,不用联网'
  return {
    floor,
    content: wrapToolResult(
      `已记下研究计划:${researchPlanSummary(floor)}${parts}。${demand}。没查到就如实说明,别编。`
    ),
    step: `研究计划:${researchPlanSummary(floor)}${parts}`
  }
}

/** 补查令:把差多少摆清楚,让它先查再答 */
export function buildResearchGateNudge(missing: string[]): string {
  return `${AGENT_RESEARCH_GATE_PREFIX}${missing.join('、')}。先按计划补查再交卷,别急着答;资料确实查不到就如实说明哪块缺。\n${TAG.programReminder.close}`
}

/**
 * 交卷闸门(纯函数,自测覆盖):只有计划里有缺口、工具还能用、预算没烧完、
 * 劝的次数没到顶、且上一劝之后确实动过手,才打回去补查 —— 否则放行,绝不死循环。
 */
export function shouldGateAnswer(input: {
  floor: ResearchFloor | null
  counts: ResearchCounts
  nudges: number
  /** 上一劝之后有没有新的工具动作;第一次劝之前不看 */
  hasNewProgress: boolean
  toolsAvailable: boolean
  webBudgetLeft: boolean
}): boolean {
  const { floor } = input
  if (!floor || !input.toolsAvailable) return false
  if (input.nudges >= RESEARCH_GATE_MAX_NUDGES) return false
  if (input.nudges > 0 && !input.hasNewProgress) return false
  if (floor.lookups > 0 && !input.webBudgetLeft) return false
  return unmetResearchFloor(floor, input.counts).length > 0
}
