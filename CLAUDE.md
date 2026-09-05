# CodeAtlas 开发须知

给每个参与开发的 AI 会话(和小葵自己)的规矩。本项目仓库**已公开**,每次 push 全世界可见。

## 提交红线(push 前自查)

1. **密钥绝不入库**:API key、token、密码、私钥一律不提交。本项目的 AI 配置(ai-config.json)存在系统用户目录,天然不进仓库,别挪进来
2. **邮箱用匿名代发**:git 邮箱只用 `feix95@users.noreply.github.com`,禁止真实邮箱(真实 Gmail 已于 2026-09-04 从全部历史洗掉,别弄回来)
3. **个人信息不进库**:本机用户名路径(如 C:\Users\xxx)、含真实盘符路径的文案、他人隐私内容(截图/聊天记录)都不提交
4. **新文件类型先想 .gitignore**:配置、日志、模型、二进制大文件,该挡先挡;大模型和引擎放 vendor/(已忽略)

## 开发规矩

- 一次只开发一个模块;禁止假实现 / TODO 占位 / 空函数
- 每完成一个模块必须自测(typecheck / lint / test / build 全绿),commit 后 push
- **严格一锤一个 commit**,不许把几个模块打包进一条提交
- 路径契约:节点只存 relPath,主进程唯一经 shared/paths 的 joinRoot 拼绝对路径
- UI 文案说人话:界面出现的每个词,非程序员要看得懂(用户是小白,不懂 llama-server 这类术语)

## 提交规范(2026-09-06 起)

- commit message 用 Conventional Commits:`<类型>(<范围>): <大白话说明>`
- 类型固定从这几种里选:`feat`(新功能)、`fix`(修 bug)、`docs`(只改文档)、`refactor`(整理不改行为)、`chore`(杂活:依赖/配置/构建)、`perf`(性能优化);范围按实际改动模块起名(如 scanner / window / ai / appearance)
- 「第几锤」编号不进 commit message,只记进 CHANGELOG.md(一条改动两笔记录:git log 一行规范话,CHANGELOG 一条大白话)
- 历史已推的 commit 保持原样,不重写历史
