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
- [ ] AI 人话解释
- [ ] Git 修改翻译
