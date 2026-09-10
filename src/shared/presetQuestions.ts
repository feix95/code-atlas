// ── 第一百零九锤:预设问题三层预测(规则打底 → AI 定制 → 静态兜底)──
// 规则层:按文件的类别套模板,零延迟零成本,选中瞬间就有得点;
// 类别认法跟速览词典一家(图标名 + 速览文本 + 文件名形状)。

export interface PresetFileInput {
  name: string
  /** 图标册名字(速览词典领的图),认类别最准的信号 */
  icon?: string
  /** 速览一句话 */
  text?: string
  languageId?: string
}

/** 万金油四问:类认不出时的兜底 —— 也就是现在界面上那四个老朋友 */
export const DEFAULT_PRESET_QUESTIONS = ['它是做什么的？', '从哪里开始读？', '修改它会影响什么？', '怎么给它加新功能？']

const CATEGORY_PRESETS: Array<{ test: (input: PresetFileInput) => boolean; questions: string[] }> = [
  {
    test: (f) => f.icon === 'test' || /测试|考卷/.test(f.text ?? '') || /\.test\.|\.spec\.|selftest/i.test(f.name),
    questions: ['它测的是哪个模块？', '怎么运行这些测试？', '还漏了什么该测的情况？']
  },
  {
    test: (f) => f.icon === 'key' || f.icon === 'lock' || /密钥|不要手动改/.test(f.text ?? ''),
    questions: ['它锁住了什么？', '动了它会发生什么？', '该提交它还是忽略它？']
  },
  {
    test: (f) => f.icon === 'config' || /配置/.test(f.text ?? ''),
    questions: ['这份配置每一项都是干嘛的？', '动哪一项会影响什么？', '默认值改过吗？']
  },
  {
    test: (f) => f.icon === 'package' && /依赖/.test(f.text ?? ''),
    questions: ['这些依赖都是干嘛的？', '哪个依赖最关键？', '有能减掉的依赖吗？']
  },
  {
    test: (f) => f.icon === 'doc' || /文档/.test(f.text ?? ''),
    questions: ['这份文档讲了什么？', '信息过时了吗？', '还缺什么该补的内容？']
  },
  {
    test: (f) => f.icon === 'entry' || /^(index|main|app)\./i.test(f.name),
    questions: ['程序启动流程是什么？', '第一步先做了什么？', '启动会读哪些配置？']
  },
  {
    test: (f) => f.icon === 'component' || /界面|组件|页面/.test(f.text ?? ''),
    questions: ['这个界面长什么样？', '它接收哪些数据？', '交互状态由谁管？']
  },
  {
    test: (f) => f.icon === 'database' || /数据库/.test(f.text ?? ''),
    questions: ['数据结构是怎么设计的？', '谁在读谁在写？', '改表要动哪些地方？']
  },
  {
    test: (f) => f.icon === 'style' || /样式/.test(f.text ?? ''),
    questions: ['样式是怎么组织的？', '改配色去哪里？', '主题变量有哪些？']
  },
  {
    test: (f) => f.icon === 'terminal' || /脚本/.test(f.text ?? ''),
    questions: ['跑它会发生什么？', '它需要什么参数？', '失败时会怎样？']
  },
  {
    test: (f) => f.icon === 'globe' || /接口|网页/.test(f.text ?? ''),
    questions: ['它对外提供什么？', '别人怎么调用它？', '出错时返回什么？']
  }
]

/** 规则层预测(纯函数,自测覆盖):按类别出题,认不出就回万金油四问 —— 永远有得点 */
export function rulePresetQuestions(input: PresetFileInput): string[] {
  for (const cat of CATEGORY_PRESETS) {
    if (cat.test(input)) return cat.questions
  }
  return DEFAULT_PRESET_QUESTIONS
}

/**
 * 模型吐回来的题先过一遍筛(纯函数,自测覆盖):剥掉编号和项目符号,
 * 只留像样的短句 —— 太短(一个字)/太长(一整段)的都扔掉,最多 3 条。
 * 概览页的预设问题和预览对话的推荐问题共用这一把尺子。
 */
export function parsePredictedQuestions(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim().replace(/^\d+[.、)]\s*/, '').replace(/^[-*]\s*/, '').trim())
    .filter((line) => line.length >= 4 && line.length <= 40)
    .slice(0, 3)
}
