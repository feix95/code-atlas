# CodeAtlas · AI 会话必读

本文件每次会话自动加载, 只收本项目独有的红线、验证命令、dev 启动流程与文档索引; 通用规矩见全局记忆, 其余项目约定见《交接文档-AI维护手册.md》, 各功能模块的规格见与它同级的 `specs/` 目录(都位于仓库外文档区, 路径见全局记忆「项目地图」; 需主动读取)。本仓库为公开仓库, push 内容即对外公开。

## 红线

1. AI 配置 `ai-config.json` 位于系统用户目录, 禁止移入仓库; 大模型与推理引擎置于 `vendor/`(已忽略)。
2. 一切 git 写操作(commit / push / pull / 合并 main)默认归小葵发令, 禁止自行执行; 例外: 全局记忆「按文档分多步的大功能」允许每步自测后本地 commit(禁止 push)。工作区积攒成规模的定稿改动、或已转战其他目标时, 简短提醒一次待提交清单而不逐条催促。「可以 commit」的分批按交接文档「提交规范」。
3. 「可以合进 main」才走交接文档「合进 main」流程, 并按「分支同步」拉齐三分支。
4. 每个 commit 必须在 CHANGELOG.md 末尾同步追加一行, 随该 commit 一起提交(纯补记 CHANGELOG 的 commit 除外); 格式见交接文档「提交规范」。

## 验证命令

- 全链(不含 CI): `npm run typecheck` → `npm run lint` → `npm test` → `npm run build` → `npm run test:journey`。合进 main 前另须 `npm run format`(CI 的 `format:check` 为硬闸)。
- 验收分流见交接文档「开发约定」验收分流条; 新增自测必须挂进 package.json 的 `test` 链。
- 类型声明和数据表不享受通用写码规范的豁免, 上限见交接文档「单文件行数」条。

## 启动 dev(`npm run dev`)

1. 先终止全部旧实例(node + electron); node 必须按 PID 精确终止。原因: 宿主 Agent 自身运行于 node, 误杀会断开当前会话。
2. 启动前执行 `Remove-Item env:ELECTRON_RUN_AS_NODE`。原因: 该变量有值时 electron 按纯 node 跑(`electron.app` 为 undefined)。
3. 确认 5173 端口已释放再启动; 启动后验证 vite 监听确为 5173。
4. 热更新能生效的小改动不重启; 需要重新拉起时由 AI 主动重启。跑全链前必须先停掉现有 dev, 测完再拉起。小葵自行运行的 dev 禁止再开第二个实例。
5. 宿主 Agent 服务重启会回收其后台 shell: 需要跨重启存活时, 在已清除 `ELECTRON_RUN_AS_NODE` 的 PowerShell 里用 `Start-Process npm.cmd -ArgumentList 'run','dev','--','--remoteDebuggingPort=9222' -WorkingDirectory <worktree> -WindowStyle Hidden -RedirectStandardOutput <日志> -RedirectStandardError <错误日志>` 分离启动。禁止用 cmd 的 `set VAR= &&` 写法(空格会吃进变量值)。

## 文件落位

跑 `test:journey` 前设 `$env:CODE_ATLAS_TMP` 指向仓库外的 `tmp/`(路径见全局记忆); 禁止把临时文件写进仓库内被忽略的目录。原因: 文件工具读不到被忽略文件, 会出现"跑了自测但没看过图"的假验收。

## 文档索引

| 场景                                                                            | 必读                                       |
| ------------------------------------------------------------------------------- | ------------------------------------------ |
| 任何代码改动开工前                                                              | 交接文档「开发约定」「产品与验收契约」     |
| 改页签、页签拖拽、拆出独立窗口、跨窗拖拽                                        | `specs/页签与窗口.md`                      |
| 改文件预览开关、JPG/PNG 看图、MP3/WAV 听音                                      | `specs/文件预览与媒体.md`                  |
| 改页签翻译                                                                      | `specs/页签翻译.md`                        |
| 改文件树、文件备注、打开为工作区、扫描与工作区生命周期                          | `specs/文件树与工作区.md`                  |
| 改 src/ai/ 下提示词、质检闸、模型与引擎、在线 API、拖入授权, 或 prompt 相关自测 | `specs/AI模块.md`                          |
| 拆大文件或改行数闸                                                              | 交接文档「开发约定」单文件行数条           |
| 改 CSS / 布局                                                                   | 交接文档「UI 改动自查清单」                |
| 写 commit message / CHANGELOG 条目                                              | 交接文档「提交规范」                       |
| 发布、升级内置引擎、新增语言支持                                                | 交接文档「开发约定」发布流程条             |
| 合并分支到 main、同步分支                                                       | 交接文档「开发约定」合进 main 与分支同步条 |
| 遇到卡点想请外部 AI 出方案, 或收到外部 AI 的回复文档                            | 交接文档「外部 AI 求助」                   |
| 修改本文件、交接文档或规格文件, 或新建规格文件                                  | 交接文档「文档维护」                       |
