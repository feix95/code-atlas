# CodeAtlas

AI 代码地图 —— 帮你不用读代码,也能看懂整个项目。

## 开发

```bash
npm install
npm run dev # 启动应用(开发模式,带热更新)
```

## 常用命令

```bash
npm run lint # 代码检查
npm run typecheck # 类型检查
npm run format # 格式化
npm run test:scanner # 目录扫描器自测
npm run test:parser # 语言识别器自测
npm run test # 全部自测
npm run build # 构建产物
```

## 进度

- [x] 第一锤:项目骨架(Electron + React + TypeScript)
- [x] 第二锤:目录扫描器(选择文件夹 → 目录树 + 文件统计)
- [x] 第三锤:语言识别器(后缀速查 + 内容嗅探,界面语言分布)
- [x] 第四锤:AST 结构分析(点文件看结构:函数/类/接口/组件/导入导出)
- [x] 第五锤:项目关系分析(谁引用谁 · 影响范围 · 最忙文件排行)
- [x] 第六锤:AI 人话解释(点「用大白话解释」,本地大模型讲这文件是干嘛的)
- [x] 第七锤:Git 修改翻译(谁动了代码,本地大模型用人话讲这次改了啥)
- [x] 第八锤:讲解大扩容(点文件夹讲它管什么 · 新增 Java/Go/C/C++/C#/Rust · 没结构的文件看名字和片段猜 · 报错全换大白话)
- [x] 第九锤:内置本地模型(AI 设置二选一:LM Studio 或 内置模型 · 推理引擎已内置零配置,小白只管「选择模型」· 流式边生成边显示 · 老配置自动搬家)
- [ ] AI 对话记录 + 追问
