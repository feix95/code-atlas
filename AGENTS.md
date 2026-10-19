# CodeAtlas · AI 会话必读

本文件每次会话自动加载, 只收红线、验证命令、dev 启动流程与文档索引; 其余项目约定见《交接文档-AI维护手册.md》(需主动读取)。本仓库为公开仓库, push 内容即对外公开。

## 红线

1. AI 配置 `ai-config.json` 位于系统用户目录, 禁止移入仓库; 大模型与推理引擎置于 `vendor/`(已忽略)。
2. 一切 git 写操作(commit / push / pull / 合并 main)归小葵发令, 禁止自行执行: 工作区积攒成规模的定稿改动、或已转战其他目标时, 简短提醒一次待提交清单而不逐条催促; 小葵说「可以 commit」时按交接文档「提交规范」的分批条提交, 说「可以合进 main」时再本地合并、push main(不强制 PR), 并按「分支同步」条拉齐三分支; push 后 CI 在 main 上验收, 合进前本地仍须验证命令全绿。
3. 同一功能调试期禁止 commit: 连续修改只改代码与跑自测, 小葵确认无问题后一次性 commit + push(其确认即 push 许可)。原因: 避免半成品逐次进入历史。
4. commit message 禁止附加工具署名(`Generated with ...`、`Co-Authored-By: ...` 等)。
5. 每个 commit 必须在 CHANGELOG.md 末尾同步追加一行, 随该 commit 一起提交(纯补记 CHANGELOG 的 commit 除外); 格式见交接文档「提交规范」。
6. 已推送的 commit 禁止重写历史。
7. `KERNEL_CORE`(src/ai/prompts.ts)为小葵逐字定稿, 禁止擅自改动。

## 验证命令

- 模块完成后按序全绿再交: `npm run typecheck` → `npm run lint` → `npm test` → `npm run build` → `npm run test:journey`。
- 纯样式/微调类的小改动不必每步跑全链, 等 commit 前跑一次全套即可; 中途只跑与改动直接相关的检查。
- commit 前必须跑 `npm run format`: CI 的 `npm run format:check` 为硬闸, 格式漂移即红灯。
- 新增自测脚本必须登记进 package.json 的 `test` 命令链: 本地 `npm test` 与 CI 只执行链内脚本, 漏挂即静默漏测。

## 启动 dev(`npm run dev`)

用于防止端口漂移、双实例混跑与会话中断:

1. 先终止全部旧实例(node + electron); node 必须按 PID 精确终止。原因: 宿主 Agent 自身运行于 node, 误杀会断开当前会话。
2. 启动前执行 `Remove-Item env:ELECTRON_RUN_AS_NODE`。原因: 宿主 Agent 可能注入该变量, 使 electron 按纯 node 运行(`electron.app` 为 undefined)。
3. 确认 5173 端口已释放再启动; 启动后验证 vite 监听端口确为 5173。
4. 小葵自行运行 dev 时禁止重复启动; 改动完成后主动重启 dev 实例。
5. 宿主 Agent 服务重启会回收它的后台 shell, 后台跑 dev 活不过重启: 需要跨重启存活时, 在 PowerShell 里先 `Remove-Item env:ELECTRON_RUN_AS_NODE`, 再用 `Start-Process npm.cmd -ArgumentList 'run','dev','--','--remoteDebuggingPort=9222' -WorkingDirectory <worktree> -WindowStyle Hidden -RedirectStandardOutput <日志> -RedirectStandardError <错误日志>` 分离启动。禁止用 cmd 的 `set VAR= &&` 写法: 空格会被吃进变量值, ELECTRON_RUN_AS_NODE 又变成"有值", Electron 按纯 node 跑, `electron.app` 为 undefined(今晚实测崩于此)。

## 文档索引

| 场景                                  | 必读                                       |
| ------------------------------------- | ------------------------------------------ |
| 任何代码改动开工前                    | 交接文档「开发约定」「产品与验收契约」     |
| 改 CSS / 布局                         | 交接文档「UI 改动自查清单」                |
| 改 src/ai/ 下提示词或 prompt 相关自测 | 交接文档「提示词体系」                     |
| 写 commit message / CHANGELOG 条目    | 交接文档「提交规范」                       |
| 发布、升级内置引擎、新增语言支持      | 交接文档「开发约定」发布流程条             |
| 合并分支到 main、同步分支             | 交接文档「开发约定」合进 main 与分支同步条 |
| 修改本文件或交接文档                  | 交接文档「文档维护」                       |
