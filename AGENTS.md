# CodeAtlas · AI 会话必读

本文件每次会话自动加载, 只收红线、验证命令、dev 启动流程与文档索引; 其余项目约定见《交接文档-AI维护手册.md》(需主动读取)。本仓库为公开仓库, push 内容即对外公开。

## 红线

1. AI 配置 `ai-config.json` 位于系统用户目录, 禁止移入仓库; 大模型与推理引擎置于 `vendor/`(已忽略)。
2. push 到 main、merge 回 main 必须经小葵验证确认; worktree/分支上完成的任务全绿后主动 commit 到branch。
3. 同一功能调试期禁止 commit: 连续修改只改代码与跑自测, 小葵确认无问题后一次性 commit + push(其确认即 push 许可)。原因: 避免半成品逐次进入历史。
4. commit message 禁止附加工具署名(`Generated with ...`、`Co-Authored-By: ...` 等)。
5. 每个 commit 必须在 CHANGELOG.md 末尾同步追加一行, 随该 commit 一起提交(纯补记 CHANGELOG 的 commit 除外); 格式见交接文档「提交规范」。
6. 已推送的 commit 禁止重写历史。
7. `KERNEL_CORE`(src/ai/prompts.ts)为小葵逐字定稿, 禁止擅自改动。

## 验证命令

- 模块完成后按序全绿再交: `npm run typecheck` → `npm run lint` → `npm test` → `npm run build` → `npm run test:journey`。
- commit 前必须跑 `npm run format`: CI 的 `npm run format:check` 为硬闸, 格式漂移即红灯。
- 新增自测脚本必须登记进 package.json 的 `test` 命令链: 本地 `npm test` 与 CI 只执行链内脚本, 漏挂即静默漏测。

## 启动 dev(`npm run dev`)

用于防止端口漂移、双实例混跑与会话中断:

1. 先终止全部旧实例(node + electron); node 必须按 PID 精确终止。原因: Devin 自身运行于 node, 误杀会断开当前会话。
2. 启动前执行 `Remove-Item env:ELECTRON_RUN_AS_NODE`。原因: Devin 注入该变量会使 electron 按纯 node 运行(`electron.app` 为 undefined)。
3. 确认 5173 端口已释放再启动; 启动后验证 vite 监听端口确为 5173。
4. 小葵自行运行 dev 时禁止重复启动; 改动完成后主动重启 dev 实例。

## 文档索引

| 场景                                  | 必读                                   |
| ------------------------------------- | -------------------------------------- |
| 任何代码改动开工前                    | 交接文档「开发约定」「产品与验收契约」 |
| 改 CSS / 布局                         | 交接文档「UI 改动自查清单」            |
| 改 src/ai/ 下提示词或 prompt 相关自测 | 交接文档「提示词体系」                 |
| 写 commit message / CHANGELOG 条目    | 交接文档「提交规范」                   |
| 发布、升级内置引擎、新增语言支持      | 交接文档「开发约定」发布流程条         |
| 修改本文件或交接文档                  | 交接文档「文档维护」                   |
