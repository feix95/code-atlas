# CodeAtlas 产品改进方案（负责人视角）

> 基于 2026-09-14 主干代码（约 2 万行 TS/TSX，12 个开发日，200+ 条 CHANGELOG）通读后写成。
> 所有判断都标了依据（文件/行号或 CHANGELOG 条目），没看到证据的地方写"推测"。

---

## 〇、一句话诊断

**这是一个"引擎已经很强、但还没装上轮子"的产品。**

- 强的地方：只读沙盒（agent.ts 三条铁律）、绝不编造的提示词体系（ai/index.ts 六套人设）、分级扫描（C 盘秒开）、上下文精算（gguf.ts + contextBill.ts）、复读防线、爆锅自救。这些都是"给小白做本地 AI 工具"里最难啃的骨头，已经啃下来了。
- 弱的地方：**没有一条通往用户电脑的路**。没打包、没发布、没安装向导、核心 AI 功能对新用户默认是死的。

所以方案的主线只有一条：**把已经做出来的能力交到第二个用户手里，然后用真实反馈决定下一步。** 功能层面的新点子（快照、直播、关系图）全部排在这条主线之后。

---

## 一、现状盘点（证据）

### 1.1 做得对的（别动）

| 决策 | 证据 | 为什么对 |
|---|---|---|
| 只读沙盒，一个写工具都没有 | `src/ai/agent.ts` 头部三条铁律；`joinRoot` 二道岗 | 用户敢把它指向整块硬盘，就是因为知道它动不了手。这是信任的地基 |
| OpenAI 兼容层抹平后端 | `ai/index.ts` 只认 `ChatTarget(baseURL+model)` | 换 LM Studio / llama-server / 未来任何后端都不动业务代码 |
| 分级扫描 + 节点预算 | `scanner/index.ts` lazy 占位 | 扫描耗时与磁盘大小无关，小白点 C 盘不卡死 |
| GGUF 头部精算上下文 | `shared/gguf.ts` 只翻键值不读模型本体 | 显存扛不住当场标红，比"OOM 崩掉"体面十倍 |
| 每个纯函数模块配自测脚本 | `scripts/selftest-*.mts` 20 个 | 自测不依赖 Electron，秒跑 |
| 文案全说人话 | AGENTS.md "UI 文案说人话" | 面向非程序员的产品，这是第一原则 |

### 1.2 结构性问题（会拖住所有后续工作）

| 问题 | 证据 | 后果 |
|---|---|---|
| **没有打包链** | package.json 无 electron-builder/forge；无 `.github/workflows`；`private: true`；version 0.1.0 | 产品只在你自己电脑上存在 |
| **tree-sitter wasm 按 node_modules 路径加载** | `analyzer/index.ts:17` `join(NODE_MODULES, 'tree-sitter-wasms', 'out', file)` | 一旦打包进 asar，AST 分析、预览分色、依赖图**全部静默失效**。这是打包的第一个坑 |
| **内置引擎要手填两个路径** | `ai/config.ts` `builtin: { serverPath: '', modelPath: '' }`；vendor/ 在 .gitignore | 新用户装上后 AI 是死的，还得先学"什么是 GGUF" |
| **AI 解释没有持久缓存** | `main/index.ts` 只有 `reportCache`（内存 Map、20 份、重启即丢）；无 explain 缓存 | 同一个文件每次点都重烧模型；30 秒等待重复发生；本地小模型这是最贵的资源 |
| **依赖图只认 JS/TS** | `depgraph/index.ts` `JS_EXTS` + `resolveJsImport` | README 写"项目关系分析"，Python/Go/Java 项目点开是空的——对小白等于"坏了" |
| **三个巨石文件** | `main/index.ts` 2265 行、36 个 IPC handler；`App.tsx` 1952 行；`main.css` 5865 行 | 每锤都在同一个文件里打，冲突率、回归率随时间指数上升。CHANGELOG 里"页签验收期六连修"就是症状 |
| **外观设置按 localhost 端口分仓** | AGENTS.md "开 dev 的铁律"；`appearance.ts` 用 localStorage | 开发时的坑，打包后也是坑（file:// origin 下 localStorage 行为不同） |
| **平台事实上 Windows-only** | `builtin.ts:491` `if (process.platform !== 'win32') return`；`ENGINE_IMAGE = 'llama-server.exe'` | 没问题，但要**写明**，别让 Mac 用户下了装不上 |
| **没有回答质量的评测** | 20 个自测全是逻辑测试，无一条测"模型答得对不对" | "绝不编造"是唯一卖点，但改一行提示词都没法知道是变好还是变坏 |
| **无 LICENSE** | 仓库根目录 | 公开仓库无许可证 = 法律上保留所有权利，别人不敢 fork/贡献 |

### 1.3 文档与协作

- README 34 行、无截图、无下载链接。目标用户是小白，README 应该是"下载→双击→选文件夹"三张图。
- `开发规范.md`（742 行）是 v0.1 的原始蓝图，很多已过时（cache/ 目录不存在、模块四"项目理解器"没落地、V2 列表和现状脱节）。它现在是"考古文档"，不是"当前真相"。
- AGENTS.md 规矩很细，这是好事；但"攒条清单"这种流程放进代码仓库对外部贡献者是噪音。

---

## 二、改进方案（按里程碑）

每个里程碑都有一个**可验证的交付物**。不给"两周"这种人类估时——按"一次专注会话能干完的量"切。

### M0 · 出厂门（最优先，1–2 个会话）

目标：**任何 Windows 用户能从 GitHub Release 下载安装包、双击、打开一个文件夹、看到目录树和一句话速览。** AI 部分允许暂时要配置。

1. **electron-builder 接入**
   - `npm i -D electron-builder`，配 `nsis` 目标（Windows），产出 `CodeAtlas-Setup-x.y.z.exe`
   - **先修 wasm 路径**：`analyzer/index.ts` 改为运行时判断 `app.isPackaged`，打包时把 `tree-sitter-wasms/out/*.wasm` 列进 `extraResources`，用 `process.resourcesPath` 拼路径。这一步不做，打包出来的 app 会"看起来能用，但结构分析全空"
   - `asarUnpack` 顺手检查 `web-tree-sitter` 的 wasm
2. **GitHub Actions**
   - `ci.yml`：push/PR 跑 `typecheck + lint + test + build`（`windows-latest`）
   - `release.yml`：打 `v*` tag 自动 build + 上传 Release
3. **electron-updater**：接 GitHub Releases provider；更新提示文案说人话（"有新版本，重启就换好"）
4. **LICENSE**：建议 MIT（想保留商用主动权可选 AGPL 或 BSL，但要想清楚——本地工具选 MIT 最能换来贡献者）
5. **README 重写**：三张截图 + 下载按钮 + "AI 功能怎么开"一段 + 平台说明（目前仅 Windows）
6. **版本号从 0.1.0 → 0.2.0**，CHANGELOG 顶部加"给用户看的版本说明"分节，跟开发流水账分开

验收：一台干净的 Windows 虚拟机，下载 → 安装 → 打开任意文件夹 → 树出来、速览出来、点文件结构网格出来。

### M1 · AI 开箱即用（1–2 个会话）

目标：**新用户装上后，不需要知道 GGUF/llama-server 是什么，五分钟内让 AI 说出第一句话。**

1. **首启向导（三步）**
   - 第一步：探测硬件（`os.totalmem()`、Windows 上 `wmic`/`nvidia-smi` 拿显存；拿不到就问"你电脑有独立显卡吗？"）
   - 第二步：按档位推荐 1–2 个模型，每个只写三句人话："多大、多快、讲得多好"。推荐档位（推测，需实测）：
     - 8 GB 内存无独显 → Qwen2.5-1.5B-Instruct Q4（~1 GB）
     - 16 GB / 集显 → Qwen2.5-3B Q4（~2 GB）
     - 独显 ≥ 6 GB → Qwen2.5-7B Q4（~4.5 GB）
   - 第三步：一键下载（HuggingFace 镜像 + 国内镜像双源，断点续传，进度条说人话），下载完自动填 `modelPath`
   - "我已经有 LM Studio"走旁路，保留现有配置页
2. **llama-server 随包分发**：把 Windows 版 llama-server（CPU + CUDA 两个二进制）放进 `extraResources`，`serverPath` 默认指向它。体积约 +30–80 MB，值得。CUDA 检测失败自动退 CPU 版
3. **配置页降级为"高级"**：现在 SettingsDialog 1282 行，把手填路径、上下文滑块、黑板账单都收进"高级选项"折叠区；普通用户只看到"当前模型：xxx · 换一个"
4. **模型状态栏第一次热身时给预期**："第一次要把模型搬进内存，大约 X 秒"（用模型大小 / 磁盘速度粗估，`builtin.ts` 已经有 `/health` 进度）

验收：干净虚拟机，装上 → 向导走完 → 点一个 `.ts` 文件 → 30 秒内 AI 给出解释。

### M2 · 信任基建：评测集 + 持久缓存（1 个会话）

目标：**能用数字回答"这次改提示词/换模型，回答变好了还是变坏了"。同时把重复烧模型的浪费砍掉。**

1. **golden 评测集 `eval/`**
   - 30–50 个样本：真实开源项目里挑的文件/文件夹/diff（用 MIT 项目，附来源）
   - 每个样本一个 YAML：输入（结构信息）、必须提到的关键词（函数名/类名）、禁止出现的词（编造的名字）、允许的最大句数
   - `npm run eval` 对当前配置的模型跑一遍，输出：命中率、编造率、平均长度、平均耗时
   - 至少两档模型的基线数字写进 `eval/BASELINE.md`
   - 这个不进 CI（要模型），但**每次动 SYSTEM_PROMPT 必须跑**，写进 AGENTS.md
2. **AI 解释持久缓存**
   - key = `sha256(文件内容) + 模型名 + 提示词版本号`；存 `userData/explain-cache/`（SQLite 或简单 JSON 分片）
   - 命中直接出，UI 标一个小灰字"上次解释过"，给"重新解释"按钮
   - 文件内容变了自动失效（这就是为什么用内容哈希而不是路径）
   - 顺手把 `reportCache` 也落盘
3. **Git 翻译缓存**：同一个 diff hash 不重烧

验收：同一个文件第二次点击 < 100ms 出解释；`npm run eval` 跑出一份报告。

### M3 · 把"关系分析"做成真的（1 个会话）

目标：**README 说了"谁引用谁"，那 Python/Go/Java/Rust 项目也得有。**

- `depgraph/index.ts` 现在只解析 JS/TS 相对导入。analyzer 已经能给这几种语言吐 imports（tree-sitter 都在），差的是各语言的**解析规则**：
  - Python：`from a.b import c` → `a/b.py` 或 `a/b/__init__.py`；相对导入 `from .x`
  - Go：同包目录 + `go.mod` module 前缀
  - Java：包名 → 目录；`import a.b.C` → `a/b/C.java`
  - Rust：`mod x;` → `x.rs` / `x/mod.rs`；`use crate::a::b`
- 解析不了的照旧记 `unresolved`，UI 上老实显示"这条引用我认不出来"（延续不编造原则）
- 不追求 100%，追求"点开一个 Python 项目，最忙文件排行不是空的"

### M4 · 巨石拆解（穿插进行，不单独立项）

不做大重构，做"每锤顺手搬一块"：

- `main/index.ts` 36 个 IPC handler → 按域拆 `main/ipc/scan.ts`、`ipc/ai.ts`、`ipc/git.ts`、`ipc/window.ts`，index.ts 只剩注册。规则：**下次碰哪个 handler 就把它搬出去**
- `App.tsx` 1952 行 → 页签系统（TabBar/paneKinds 已经是独立文件）之外，把"选中态 + 详情路由"抽成 `useSelection`、`useWorkbench` 两个 hook
- `main.css` 5865 行 → 按组件拆文件（CSS 本身不用换方案，就是拆文件），或者引 CSS Modules。设计 token 已经收拢过（CHANGELOG "设计 token 收拢"），拆起来不痛
- **外观设置从 localStorage 搬到主进程文件**（跟 `ai-config.json` 一样落 userData）：一次性解决"端口变了就出厂设置"和打包后 origin 差异两个问题，AGENTS.md 那条"开 dev 铁律"就可以删了

### M5 · 用户反馈闭环（半个会话）

- **"导出诊断包"按钮**：devlog（已有 `shared/devlog.ts`）+ 脱敏后的配置（去掉 apiKey 和绝对路径）+ 版本号 + 硬件信息 → 一个 zip。用户报 bug 拖给你就行
- **应用内"这条解释不对"按钮**：把输入结构 + 模型输出 + 用户一句话存本地 `feedback/`，用户愿意的话一键导出——这就是评测集的**天然来源**
- GitHub Issue 模板：bug / 模型答错 / 功能建议 三种，bug 模板要求附诊断包

---

## 三、功能层面的方向建议（M0–M2 落地之后再决定）

这部分哥不下死结论，因为**还没有第二个用户的数据**。列出候选和判断依据：

| 候选 | 一句话 | 跟只读原则的关系 | 哥的判断 |
|---|---|---|---|
| **项目快照对比** | 进项目时自动记一份文件清单+哈希，随时回答"跟上次比多了啥少了啥改了啥" | 纯读，快照存 userData 不碰项目 | **最推荐**。给不用 git 的小白一个"回头看"的锚点；技术上就是 scanner 结果 + 内容哈希落盘 + diff |
| **目录变更自动播报** | 盯目录，外部工具一改文件就自动翻人话 | 纯读（fs.watch） | 值得做但要看用户是否真的一边开 CodeAtlas 一边开 Cursor。先做快照，播报是快照的实时版 |
| **可视关系图** | 开发规范 V2 第一条 | 纯读 | 好看但**不刚需**。小白看到节点连线图第一反应是"这是啥"。先把 M3 的排行做扎实，图放后面 |
| **"XX 功能在哪"搜索** | 开发规范 V2；FeatureLocator 已有雏形 | 纯读 | 已经有了，深挖方向是**结果可信度**（配合 M2 评测） |
| **VSCode / Cursor 插件** | 开发规范 V2 | — | **暂缓**。目标用户是小白，插件是给程序员的形态。桌面 app 站稳再说 |
| **多项目工作区** | 同时开几个文件夹 | 纯读 | 等用户要 |
| **英文界面** | i18n | — | 文案全是"人话中文"，翻译成本高且会丢味道。除非有海外需求，暂缓 |

---

## 四、流程与规矩建议

1. **AGENTS.md 拆两份**：对外的 `CONTRIBUTING.md`（红线、提交规范、UI 自查清单）+ 对内的 `AGENTS.md`（攒条清单、开 dev 铁律、称呼偏好）。后者可以继续放仓库，但外部贡献者不用读
2. **`开发规范.md` 归档进 `ref/`**，标"v0.1 原始蓝图，已过时"；当前真相以 README + CHANGELOG 为准
3. **CHANGELOG 分两层**：顶部"版本说明"（给用户，每个 Release 一段人话），下面"开发流水"（现在这样）
4. **每次动 `SYSTEM_PROMPT` 系列必跑 `npm run eval`**，结果贴进 commit message（M2 之后）
5. **保留"一次只开发一个模块"**，这条规矩是这 12 天能推这么多锤还没崩的原因

---

## 五、优先级总表

| 序 | 里程碑 | 交付物 | 为什么排这 |
|---|---|---|---|
| 1 | M0 出厂门 | 可下载安装包 + CI + LICENSE + README | 出不了门一切白搭；wasm 路径坑必须先踩 |
| 2 | M1 AI 开箱即用 | 首启向导 + 引擎随包 | 核心功能默认是死的 |
| 3 | M2 评测集 + 缓存 | `npm run eval` + 持久缓存 | 唯一卖点要有证据；重复烧模型是最大浪费 |
| 4 | M3 多语言关系 | Python/Go/Java/Rust 依赖解析 | README 已承诺，现在是半成品 |
| 5 | M5 反馈闭环 | 诊断包 + 解释纠错 | 一人维护，靠它省命 |
| 穿插 | M4 拆巨石 | 每锤搬一块 | 不单独立项，避免"重构月" |
| 之后 | 快照对比 → 变更播报 | 看 M0–M2 后的真实反馈 | 别在没用户时猜用户 |

---

## 六、如果只能做一件事

**M0。** 具体到第一个 commit：`chore(build): 接入 electron-builder，修 tree-sitter wasm 打包路径，出第一个 Windows 安装包`。

这一锤下去，CodeAtlas 从"小葵的项目"变成"一个产品"。后面所有事都是在这个基础上迭代。
