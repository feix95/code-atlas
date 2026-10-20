# CodeAtlas · AI 会话必读

本文件每次会话自动加载, 只收红线、验证命令、dev 启动流程与文档索引; 其余项目约定见《交接文档-AI维护手册.md》(需主动读取)。本仓库为公开仓库, push 内容即对外公开。

## 红线

1. AI 配置 `ai-config.json` 位于系统用户目录, 禁止移入仓库; 大模型与推理引擎置于 `vendor/`(已忽略)。
2. 一切 git 写操作(commit / push / pull / 合并 main)默认归小葵发令, 禁止自行执行。工作区积攒成规模的定稿改动、或已转战其他目标时, 简短提醒一次待提交清单而不逐条催促。
3. 「可以 commit」= 按交接文档「提交规范」分批 commit, 并 push 当前工作分支; 仅当小葵明确要求「只交本地」时不 push。「可以合进 main」才走交接文档「合进 main」流程并按「分支同步」拉齐三分支。
4. 按文档分多步实施的大功能: 每步自测通过后可主动本地 commit、禁止 push; 整件经小葵验收通过后再 push 当前分支。单项功能调试期禁止中途 commit, 等「可以 commit」。
5. commit message 禁止附加工具署名(`Generated with ...`、`Co-Authored-By: ...` 等)。
6. 每个 commit 必须在 CHANGELOG.md 末尾同步追加一行, 随该 commit 一起提交(纯补记 CHANGELOG 的 commit 除外); 格式见交接文档「提交规范」。

## 验证命令

- 全链(不含 CI): `npm run typecheck` → `npm run lint` → `npm test` → `npm run build` → `npm run test:journey`。合进 main 前另须 `npm run format`(CI 的 `format:check` 为硬闸)。
- 验收分流见交接文档「开发约定」验收分流条; 新增自测必须挂进 package.json 的 `test` 链。

## 启动 dev(`npm run dev`)

1. 先终止全部旧实例(node + electron); node 必须按 PID 精确终止。原因: 宿主 Agent 自身运行于 node, 误杀会断开当前会话。
2. 启动前执行 `Remove-Item env:ELECTRON_RUN_AS_NODE`。原因: 该变量有值时 electron 按纯 node 跑(`electron.app` 为 undefined)。
3. 确认 5173 端口已释放再启动; 启动后验证 vite 监听确为 5173。
4. 热更新能生效的小改动不重启; 需要重新拉起时由 AI 主动重启。跑全链前必须先停掉现有 dev, 测完再拉起。小葵自行运行的 dev 禁止再开第二个实例。
5. 宿主 Agent 服务重启会回收其后台 shell: 需要跨重启存活时, 在已清除 `ELECTRON_RUN_AS_NODE` 的 PowerShell 里用 `Start-Process npm.cmd -ArgumentList 'run','dev','--','--remoteDebuggingPort=9222' -WorkingDirectory <worktree> -WindowStyle Hidden -RedirectStandardOutput <日志> -RedirectStandardError <错误日志>` 分离启动。禁止用 cmd 的 `set VAR= &&` 写法(空格会吃进变量值)。

## 代码地图(graphify)

- 回答代码结构、文件关系或架构问题前, 必须先跑 `graphify query "<问题>"`; 查符号关系用 `graphify path "<A>" "<B>"`, 查概念用 `graphify explain "<概念>"`, 读完图再按需读源码。`GRAPH_REPORT.md` 只在需要全局架构时读。
- 派发探索代码的子代理时, 必须把上一条原样写进子代理提示词。
- 改动代码后跑 `graphify update .`(AST 更新, 不调用大模型)。commit 与 merge 后分别由 `.husky/post-commit`、`.husky/post-merge` 自动执行同样的更新, 日志在用户目录 `.cache/graphify-rebuild.log`; 重装 hook 后必须重新去掉 linked worktree 跳过段, 否则 worktree 内不触发更新。

## 文件落位

- 临时文件、截图、调试脚本写入仓库外、与 `worktrees/` 并列的 `tmp/`(绝对路径见全局记忆); 用完清理; 禁止写进仓库内被忽略的目录。跑 `test:journey` 前设 `$env:CODE_ATLAS_TMP` 指向该 `tmp/`。
- 需求、方案、验收标准等长期文档放 `docs/`; 未完成需求放 `docs/to-do list/`, 已完成或舍弃的移入 `docs/archive/`。

## 文档索引

| 场景                                  | 必读                                       |
| ------------------------------------- | ------------------------------------------ |
| 任何代码改动开工前                    | 交接文档「开发约定」「产品与验收契约」     |
| 改 CSS / 布局                         | 交接文档「UI 改动自查清单」                |
| 改 JPG/PNG 看图缩放                   | 交接文档「产品与验收契约」看图条           |
| 改 MP3/WAV 听音                       | 交接文档「产品与验收契约」听音条           |
| 改 src/ai/ 下提示词或 prompt 相关自测 | 交接文档「提示词体系」                     |
| 写 commit message / CHANGELOG 条目    | 交接文档「提交规范」                       |
| 发布、升级内置引擎、新增语言支持      | 交接文档「开发约定」发布流程条             |
| 合并分支到 main、同步分支             | 交接文档「开发约定」合进 main 与分支同步条 |
| 重建代码地图、查询指向不存在的文件    | 交接文档「代码地图(graphify)」             |
| 修改本文件或交接文档                  | 交接文档「文档维护」                       |
