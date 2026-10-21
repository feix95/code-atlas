# Code Atlas 地基重构需求文档(给执行 Agent)

> **基准提交**:本文所有行号、数值均以 `origin/UI-creator` 的 `1b1ed2b`(feix95,2026-10-21 06:00:57 UTC+8,"docs(core): 交接文档补代码地图(graphify)用法与页签拖拽落点口径")为准。开工前先 `git fetch`;若 `origin/UI-creator` 已前进,行号可能漂移,以符号名/代码片段重新定位,不要按行号盲改。
>
> 来源:2026-10-21 对上述提交做的只读系统审查(导出副本 + typecheck/lint/format/test/build/audit/jscpd/madge/knip/函数长度统计)。本文只收录审查中核实过的事实。

---

## 1. 背景

Code Atlas(仓库 `feix95/code-atlas`)是给「不读代码的项目主人」用的 Windows 桌面代码地图:Electron 44 + React 19 + TypeScript 6 + web-tree-sitter(wasm)。`src/` 共约 57,440 行(ts/tsx/css)。

项目早期由不太专业的 Agent 生成,曾出现「代码越写越大」。仓库已有 `scripts/selftest-filesize.mts` 千行文件棘轮闸(白名单已清空,没有超过 1000 行的文件),但审查发现:

- **问题不在文件大,在函数大**:超过 200 行的函数 27 个,最大的 `App` 组件 800 行、`runAgentChat` 499 行、`aiChat` IPC 回调 347 行。文件是靠「切文件」压到千行内的,职责并没有拆开。
- **DRY**:复制粘贴率低(jscpd 0.84%),但存在「同一件事写了多套」的结构性重复(两套右键菜单、三套平移缩放视口、两份 tree-sitter 引擎初始化等)。
- **安全 P0**:主进程完全信任渲染层传来的 `rootPath` 和 `builtin.serverPath`,渲染层一旦被攻破即可覆盖任意已存在文件、拉起任意可执行文件;同时 `README.md:46` 的「只读沙盒」说法与代码不符。
- **CI 两道闸会在下次推 main 时变红**(audit 有 high、format:check 有 3 个文件不过)。

## 2. 目标

1. 先止血:让 CI 的 audit / format:check 恢复绿色,修正 README 与代码不一致处,修已确认的小 bug。
2. 安全加固(用户已拍板):项目根白名单约束写文件与改名;`serverPath` 不再接受渲染层写入;加 CSP 与 `will-navigate` 拦截。
3. 地基:单一职责、低耦合、拆巨型函数、消除结构性重复;新增「函数行数」棘轮闸,防止回潮。
4. 每一步都有可验证的验收标准,执行后可与附录基线对比。

## 3. 非目标(本次不做)

- **不做新功能**,不改产品行为(安全加固除外,见 SEC 阶段)。
- **不改 UI 视觉**:CSS 规范化必须是「像素级不变」的重构(换变量名可以,数值不变)。
- **不升级大版本依赖**:`web-tree-sitter` 0.20→0.27、`vite` 8、`typescript` 7、`electron-vite` 6、`@vitejs/plugin-react` 6 都不在本次范围。只允许补丁级升级(如 vite 7.3.6→7.3.7)。
- 不动「画面心跳看门狗 reload 兜底」逻辑(见 §7)。
- 不直接开 `sandbox: true`(只评估,见 §7)。
- 不把 tree-sitter 解析迁到 Worker/utilityProcess(性能项,只记录,见 §7)。
- 不删除 knip 报告的疑似死函数,除非人工复核通过(见 §7)。

## 4. 工作方式与仓库规矩

### 4.1 分支

- 从 `origin/UI-creator` 开新分支(建议 `refactor/foundation`;可按 PR 再分子分支),PR 提回 `UI-creator`。
- **不要**直接 push `UI-creator` 或 `main`,不要走手册里的「合进 main」流程(那需要小葵发令)。
- 注意 AGENTS.md 红线 2-4:git 写操作默认归小葵发令。执行 Agent 若在受这条红线约束的会话里运行,commit/push/开 PR 前须得到授权。

### 4.2 开工前必读

1. 仓库根 `AGENTS.md`(红线、验证命令、dev 启动流程、文件落位)。
2. `README.md`。
3. 《交接文档-AI维护手册.md》:尤其「开发约定」「提交规范」「产品与验收契约」「UI 改动自查清单」「提示词体系」。
4. `docs/`(`docs/archive/` 下有 UI 工作台、关系图谱、预览编辑等方案原文;`docs/to-do list/` 当前为空)。
5. **如果环境里有 graphify**:按 AGENTS.md 先 `graphify query "<问题>"` / `graphify path` / `graphify explain` 查代码地图再读源码;改动后 `graphify update .`。审查环境里没有 graphify,本文结论来自 madge/knip/jscpd/TS AST 统计。

### 4.3 提交与验证

- **一个提交只做一件事**;拆分类提交「纯搬家不改行为」(手册「单文件行数上限」条)。
- commit message 用 Conventional Commits 单行格式 `<type>(<scope>): <说明>`,scope 取手册列出的模块名;**禁止**附加工具署名(`Co-Authored-By` 等)。
- **每个 commit 必须在 `CHANGELOG.md` 末尾追加一行**,随该 commit 一起提交(手册「提交规范」)。
- 每个提交都要跑通:`npm run typecheck` → `npm run lint` → `npm run format:check` → `npm test` → `npm run build`。涉及窗口/渲染行为的 PR 合并前另跑 `npm run test:journey`(需在 `build` 之后、先停掉 dev,见 AGENTS.md)。
- Node 需 ≥ 22.12(electron 44 要求;CI 用 Node 24)。Node 20 跑不了 `.mts` 自测。
- **已知平台差异**:在 Linux 上 `npm run test:agent` 会在 `scripts/selftest-agent.mts:113-114` 失败(断言用 `D:\shared\demo` 这类 Windows 路径,Linux 下 `isPathInside` 按 posix 语义算)。`npm test` 用 `&&` 串联,它失败会挡住后面所有套件。在 Windows 上应全绿;在 Linux 上请逐个跑套件,允许且只允许这一处失败,并在 PR 描述里注明。是否改成跨平台断言需人工决定(§7)。
- 新增自测必须挂进 `package.json` 的 `test` 链(AGENTS.md)。
- 临时文件写仓库外(AGENTS.md「文件落位」),不要写进仓库内被忽略的目录。

---

## 5. 任务清单

阶段顺序:**S0 止血 → SEC 安全加固 → S1 补特征测试 → S2 合并重复 → S3 拆巨型函数 + 函数行数闸 → S4 CSS 规范化与安全评估**。

> **为什么把安全单独成 SEC 阶段并放在 S0 之后、S1 之前**:
>
> 1. 它是 P0,用户已拍板方案,不依赖任何重构;
> 2. 改动面小且集中(`ipcScan`/`ipcEdit`/`fileEdit`/`ipcModel`/`atlasWindow`/`index.html`),自带单测即可兜底,不需要等 S1 的大特征测试;
> 3. 和止血分开是为了 PR 审阅:止血是零风险的配置/文案修复,安全改动会改变运行时行为(拒绝写入、CSP 可能拦资源),需要单独审、单独回滚;
> 4. 放在重构之前,后续 S2/S3 搬代码时就会连同白名单校验一起搬,不会遗漏。

---

### S0 止血

#### S0-1 vite 补丁升级,消除 audit high

- **目标**:`npm audit --audit-level=high` 通过。
- **现状**:`package.json:115` `"vite": "^7.3.6"`,lock 里装的是 7.3.6;`npm audit` 报 9 个(8 moderate,1 high),high 是 vite 7.0.0-7.3.6(launch-editor:GHSA-698v-4r3x-3vcv、GHSA-r825-w8mm-5pxw、GHSA-587h-7wmj-h5pm),修复版本 7.3.7。生产依赖 `--omit=dev` 为 0 漏洞。
- **改法**:升到 `vite@7.3.7`(`npm install -D vite@7.3.7` 或 `npm audit fix`,**不要** `--force`),确认 lock 只动 vite 相关条目;package.json 范围写 `^7.3.7`。
- **验收**:`npm run audit` 退出码 0;`npm ls vite` 为 7.3.7;`npm run build` 通过,产物体积与基线(附录 A.6)同量级。
- **风险**:极低。不得顺手升级其他包。
- **依赖**:无。

#### S0-2 lint-staged 覆盖 `.mts`,修复 format:check

- **目标**:CI 的 `format:check` 变绿,且以后 `.mts` 不再漏网。
- **现状**:`package.json:117-118` lint-staged 只匹配 `*.{ts,tsx}`,`scripts/*.mts` 提交时不过 prettier。当前 `prettier --check .` 失败于 `scripts/selftest-agent.mts`、`scripts/selftest-ai.mts`、`scripts/selftest-session.mts`(均是折行差异,最后修改来自 `70e3881`)。
- **改法**:两个提交:①把 lint-staged 的 glob 改为 `*.{ts,tsx,mts,cts}`;②对这 3 个文件跑 `npx prettier --write`(纯排版)。纯排版提交可以登记进 `.git-blame-ignore-revs`(手册「排版归 prettier」条)。
- **验收**:`npm run format:check` 退出码 0;`git diff --stat` 只涉及上述文件。
- **风险**:无。
- **依赖**:无。

#### S0-3 CI 在 PR 上也跑

- **目标**:与手册一致。手册「合进 main」条写的是「以工作分支向 main 开 PR,等 GitHub CI 全绿」,但 `.github/workflows/ci.yml:4-6` 只有 `push: branches: [main]`,PR 不会触发 CI。
- **改法**:`on:` 增加 `pull_request:`(目标分支至少 `main`、`UI-creator`)。check 与 audit 两个 job 不变。
- **验收**:YAML 语法有效(`npx prettier --check .github/workflows/ci.yml` 通过);PR 页面出现 CI check。
- **风险**:低。
- **依赖**:建议在 S0-1、S0-2 之后,否则 PR 一开就红。

#### S0-4 release.yml 下载的 llama.cpp 引擎补 sha256 校验

- **目标**:发布包与应用内安装器同一标准。应用内安装器已经校验 sha256(`src/ai/enginePackage.ts:59-63`,登记值在 `src/shared/engineCatalog.ts`),但 `.github/workflows/release.yml:28` 是 `curl -sL` 直下 zip,不校验。
- **改法**:在 release.yml 下载步骤中增加 `LLAMA_SHA256=<值>` 和 `echo "$LLAMA_SHA256  engine.zip" | sha256sum -c -`;`curl` 加 `-f`(失败即退)。sha256 值从 llama.cpp 官方 release 资产核对(若 `engineCatalog.ts` 已登记同 tag 的 CPU x64 包可直接复用并注释来源)。**不得编造哈希**;拿不到官方值就停下报告。
- **验收**:release.yml 里有校验步骤;手册「发布流程」条补一句「升级引擎同时改 LLAMA_TAG 与 LLAMA_SHA256」(同一提交)。
- **风险**:低;哈希填错会让发布失败(而不是静默放行),这是期望行为。
- **依赖**:无。

#### S0-5 README 与实际能力对齐

- **目标**:按用户决定,保留编辑功能,改写 README 说法。
- **现状**:`README.md:46` 写「**只读沙盒**:Atlas 没有改文件的能力,指它到整块硬盘也动不了你一根手指头的东西」;但 `src/preload/index.ts:158`(`saveFile`)、`:161`(`renameFile`)暴露写入通道,`src/main/fileEdit.ts:64` 写盘(`fs.writeFile`)、`:113` 改名(`fs.rename`)。
- **改法**:改写为与 SEC 完成后实际一致的表述,例如:「浏览和阅读不会触发 AI,也不会改动文件;编辑或改名只会写入你在本次运行中打开的项目文件夹内的文件。」措辞遵守手册「界面文案标准」。若 README 其它处(如「它能干什么」)需同步提及「可编辑」,一并改。
- **验收**:`rg -n "只读沙盒|没有改文件的能力" README.md` 无结果;新表述与 SEC-1 行为一致。
- **风险**:无。**注意 SEC-1 合并前 README 新表述就已生效**;若 S0 与 SEC 不在同一批发布,可以把本任务放进 SEC 的 PR,或在 S0 PR 里先用不含「只能写项目内」承诺的中性表述。执行时二选一并在 PR 描述写明。
- **依赖**:无(表述承诺依赖 SEC-1)。

#### S0-6 声明直接依赖 `@lezer/common`

- **现状**:`src/renderer/src/editor/markdownLive.ts:17`、`src/renderer/src/editor/tableDom.ts:5` 直接 import `@lezer/common`,但 package.json 未声明(knip「Unlisted dependencies」),目前靠 CodeMirror 的传递依赖碰巧可用。lock 中版本为 1.5.3。
- **改法**:`dependencies` 加 `"@lezer/common": "^1.5.3"`(与 lock 现有版本一致,不得引入新版本)。
- **验收**:`npx knip` 不再报 Unlisted `@lezer/common`;`npm ls @lezer/common` 无重复版本;build 通过。
- **依赖**:无。

#### S0-7 模型下载进度发给正确的窗口

- **现状**:`src/main/ipcModel.ts:83` `const win = BrowserWindow.getAllWindows()[0] ?? null`。日志窗(`openDevLogWindow`)开着时 `[0]` 可能不是主窗,下载进度会推错窗。`src/main/ipcShell.ts:96-99` 的注释说明同类问题(对话框挂错窗)已经修过一次,修法是 `BrowserWindow.fromWebContents(event.sender)`。
- **改法**:改用 `BrowserWindow.fromWebContents(event.sender)`(handler 已有 `_event` 参数,改名为 `event`),或 `appShell.ts` 导出的 `mainWindowRef`(`src/main/index.ts` 已从 appShell 导入它)。二选一,与 `ipcEngine.ts:60` 现有写法保持一致优先。
- **验收**:`rg -n "getAllWindows\(\)\[0\]" src` 无结果;typecheck 通过。
- **依赖**:无。

#### S0-8 User-Agent 版本号不再写死

- **现状**:`src/main/aiEvidence.ts:67/82/96` 与 `src/ai/weblookup.ts`(Node 版传输,约 :113-127)写死 `CodeAtlas/0.1`,实际 `package.json` 版本 0.2.0。
- **改法**:本任务只做最小修:抽一个常量(如 `shared/` 下 `USER_AGENT`)。主进程用 `app.getVersion()` 拼版本;自测走的 Node 版允许固定串。**合并两份传输实现是 S2-4 的事**,本任务不做。
- **验收**:`rg -n "CodeAtlas/0\.1" src` 无结果。
- **依赖**:无(S2-4 会在此基础上合并)。

---

### SEC 安全加固(P0,用户已拍板)

> 背景事实:`src/shared/paths.ts:15 joinRoot` 只保证 relPath 不越出 rootPath,**rootPath 本身由渲染层任意传入**。`src/main/ipcEdit.ts:25-34`(saveFile)、`:38-52`(renameFile)把渲染层的 `rootPath` 直接交给 `saveTextFile`/`renameTextFile`(`src/main/fileEdit.ts:37`、`:77`)。窗口 `sandbox: false`(`src/main/atlasWindow.ts:20`),`src/renderer/index.html` 没有 CSP,主进程没有 `will-navigate` 拦截(全仓 `rg "will-navigate|onHeadersReceived"` 无结果)。
> 缓解因素(已核实):渲染层无 `innerHTML`/`dangerouslySetInnerHTML`(`MiniMD.tsx:10` 注释明确不用);Markdown 链接不渲染成 `<a href>`;外链只放行 http/https/mailto(`src/main/auxWindows.ts:51-80`)。所以这是「纵深防御缺失」,不是已证实的可利用漏洞。

#### SEC-1 主进程「本次打开的项目根」白名单,约束写文件与改名

- **目标**:`saveFile`、`renameFile` 只对白名单内的项目根生效。
- **改法**:
  1. 在 `src/main/` 新增小模块(如 `projectRoots.ts`):进程内存 `Set`,不落盘;key 用 `realpath` 后的绝对路径,`win32` 下小写比较(参照 `src/main/agentAccess.ts:67/106` 的写法)。导出 `registerProjectRoot(path)`、`assertWritableRoot(rootPath): Promise<string>`。
  2. 登记点:`src/main/ipcScan.ts:21-46` 的 `scanFolder` 在 `stat.isDirectory()` 校验通过、扫描成功后登记该根。(会话恢复也是渲染层调 `scanFolder`,无需额外入口;执行时用 `rg scanFolder src/renderer` 核实。)
  3. 校验点:`saveTextFile`、`renameTextFile` 开头(或 `ipcEdit.ts` handler 内,二选一,建议放 `fileEdit.ts` 让纯函数可测):rootPath 必须在白名单;目标路径用 `realpath` 校验仍在根内(防目录联接/符号链接逃逸,写法参照 `agentAccess.ts:36-44 joinAuthorizedRoot`);改名的新路径同样校验。
  4. 拒绝时抛人话错误(走 `shared/fsMessages.ts` 风格),渲染层沿用现有错误展示,不新增 UI。
  5. 读取类通道(`readPreview`、`analyzeFile`、`browseDir`、`depGraph`、`atlas-media` 协议)**不在本任务范围**:产品支持全盘浏览(手册「全盘浏览」条),读不受白名单约束。
- **验收**:
  - 新增自测(如 `scripts/selftest-projectroots.mts`,挂进 `test` 链)至少断言:未登记根写入被拒;已登记根内写入成功;`relPath` 含 `..` 被拒(已有);根内符号链接/联接指向根外时被拒(Linux 用 symlink,Windows 用 junction 或跳过并注明);改名目标越界被拒;Windows 大小写不同的同一根视为已登记。
  - `scripts/selftest-fileedit.mts` 原有断言仍全绿(若其直接调用 `saveTextFile`,需在测试里先登记根,并保持原断言语义)。
  - `npm run test:journey` 中编辑/改名相关用例仍通过。
- **风险**:用户把整块盘(如 `C:\`)当项目打开时,该盘都可写,这与「写入只落在打开的项目根内」的决定一致,但要在 PR 描述里写明。不要顺手改 `watchFile`/`unwatchFile`。
- **依赖**:无。

#### SEC-2 `builtin.serverPath` 不再接受渲染层写入

- **现状**:`src/main/ipcModel.ts:97-121` `aiConfigSave` 校验 `bi.serverPath` 是字符串后原样写入(`:121`),之后 `src/ai/engineLocator.ts:87-90` 把它当可执行程序路径(「自指路径(高级用法)」),由 `src/ai/builtinLaunch.ts`(spawn 约 :223)拉起。核实:渲染层源码里**没有任何地方**读写 `serverPath`(`rg serverPath src/renderer` 无结果),设置页只是把读到的配置整体回传;`aiPickFile`(`ipcModel.ts:252-262`)只用来选 `.gguf` 模型。即这个字段只能靠手改 `ai-config.json` 设置。
- **改法**:`aiConfigSave` 里 `builtin.serverPath` 改为**沿用 `previous.builtin.serverPath`**(`previous` 已在 handler 内 `loadAiConfig` 得到),忽略渲染层传值;`modelPath` 行为不变。在注释里写明「serverPath 只能由用户手改 ai-config.json,渲染层无权写」。
- **验收**:新增断言(放进现有 AI 配置相关自测,如 `selftest-ai.mts` 或 `selftest-engine.mts`;若 handler 不便单测,先把「合并新旧配置」抽成纯函数再测):旧值 `A`、渲染层传 `B` → 落盘仍为 `A`;旧值空、传 `B` → 落盘为空。原有「换引擎设置就重启子进程」逻辑(`ipcModel.ts` 约 :137-147)不受影响。
- **风险**:若小葵有通过界面设置 serverPath 的预期,会失效;核实结论是界面没有此入口,但 PR 描述需写明。
- **依赖**:无。

#### SEC-3 渲染页加 CSP

- **改法要点**(执行时以实测为准):
  - 打包产物要严格,dev 不能被 Vite HMR/React Refresh 的内联脚本和 websocket 打断。建议只在生产生效:`app.isPackaged` 时通过 `session.defaultSession.webRequest.onHeadersReceived` 注入,或用只作用于 build 的 Vite 插件写 `<meta http-equiv="Content-Security-Policy">`。二选一并写理由。
  - 需要放行的已知资源(审查核实):`img-src` 需 `data:`(图片预览与聊天图片走 dataUrl,`ImagePreview.tsx:83`、`FreeChatPanel.tsx:382`、`FreeChatComposer.tsx:424`);`media-src` 需 atlas-media 协议(`src/main/audioMediaProtocol.ts:13` 注册,`AudioPreview.tsx:73`);React `style={}` 与 CodeMirror 注入样式需 `style-src 'unsafe-inline'`;UI 工作台有 `sandbox="allow-same-origin"` 的 iframe(`CanvasStage.tsx:88`);子窗是 `about:blank` + Portal(`useAuxWindows.ts:66`)。`connect-src` 原则上只需 `'self'`(网络请求都在主进程,用 `net.fetch`/`fetch`),执行时核实渲染层无直接网络请求。
  - 起点建议:`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' atlas-media:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'self' about:`(以实测为准)。
- **验收**:`npm run build` 后 `npm run test:journey` 通过;打包运行时 DevTools 控制台无 CSP violation(在 PR 里附检查方式与结果);看图、听音、聊天贴图、UI 工作台画布、拆出子窗五个场景手动或 journey 验证正常。
- **风险**:中。CSP 拦错资源会让某个功能静默失效,所以单独提交、单独可回滚。
- **依赖**:无。

#### SEC-4 `will-navigate` 拦截与新窗口兜底

- **现状**:`setWindowOpenHandler` 只装在主窗(`src/main/auxWindows.ts:51`);主窗与日志窗都用 `WEB_PREFS`(`src/main/atlasWindow.ts:18-24`,`appShell.ts:115/171`),没有 `will-navigate` 处理。
- **改法**:在 `atlasWindow.ts` 的建窗共用部分(或 `loadView` 附近)给每个 BrowserWindow 的 webContents 加 `will-navigate`:只允许导航到本应用自身 URL(dev 的 `ELECTRON_RENDERER_URL` 同源 / 打包后的 `index.html` file URL);其他一律 `preventDefault()`;http/https/mailto 可复用 `auxWindows.ts:72-76` 的规则交给 `shell.openExternal`。日志窗也要装 `setWindowOpenHandler` 兜底(返回 deny,同样的外链规则)。**不要**在主窗上再装第二个 `setWindowOpenHandler`(`auxWindows.ts:46-48` 注释:每个 webContents 只有一个,会顶掉子窗桥)。
- **验收**:把外部文件拖进窗口、页面内跳外链时窗口不被导航走(journey 或手动验证并记录);子窗拆出仍正常;日志窗打开正常。
- **风险**:低-中;漏放行自身 URL 会导致白屏,必须在 dev 与打包两种模式都验证。
- **依赖**:无。

---

### S1 补特征测试(S3 拆巨型函数之前必须完成)

> 现状(已核实):`scripts/` 里没有任何自测导入 `src/main/ipcChat.ts`、`src/main/agentChat.ts`、`src/main/agentTools.ts`、`src/main/ipcScan.ts`、`src/main/ipcModel.ts`;最重的主进程逻辑只靠 `test:journey` 端到端覆盖。没有 React 组件测试。特征测试的目的是**固定现有行为**,不是验证行为对错;发现疑似 bug 只记录,不在 S1 修。
> 约束:自测不访问真实网络,联网一律 mock 注入(手册「自测不访问真实网络」条)。提示词逐字断言要同步(手册「提示词体系」条)。

#### S1-1 `aiChat` 处理链特征测试

- **对象**:`src/main/ipcChat.ts:76-422`(`ipcMain.handle(CH.aiChat, …)` 回调,347 行)。
- **改法**:先做**最小可测性改造**(单独提交、纯搬家):把回调体提成可导入的 `async function handleAiChat(deps, event, req)`,`deps` 注入模型 HTTP、联网、配置读取、`event.sender.send`。然后新增 `scripts/selftest-aichat.mts`,用 mock 覆盖至少这些分支(都来自回调内的注释段落):纯文字问答;只发引用/文件不发问题(兜底问法);带图 + 纯文本模型被拦;带图强制不走翻文件;部分文件附件被拒的灰字;联网开启时的状态播报顺序(searching → completed/failed/empty);思考模式额度加成;`/compact` 摘要垫入;翻文件模式分流到 agent 路;上下文装不下报人话错误。断言对象是「发给模型的 messages 结构 + 推给渲染层的事件序列 + 返回值」的快照。
- **验收**:新套件挂进 `test` 链且全绿;覆盖上面 ≥10 个分支;`git diff` 证明可测性改造提交没有改逻辑(只是挪位置和注入依赖)。
- **风险**:中。依赖面大,mock 写不全容易漏;快照过度依赖提示词逐字文本时,要与现有 selftest-ai/agent 的口径一致。
- **依赖**:SEC 完成(避免与 SEC 改动冲突)。

#### S1-2 `runAgentChat` 工具调用循环特征测试

- **对象**:`src/main/agentChat.ts:81-579`(499 行),含提醒卡、质检闸、复读兜底、紧急瘦身、封板、降级重答等多个「只许用一次」的兜底(见其内部注释)。
- **改法**:用脚本化的假模型(按轮返回预设的 tool_call/文本/错误)驱动,工具执行用 `src/main/agentTools.ts` 的真实实现 + 临时目录(或 mock)。至少覆盖:正常 list/read/search 后作答;越界路径被拒后换路;复读兜底触发一次后截断;上下文爆掉触发紧急瘦身一次后报错;4xx 后撤提醒卡重答一次;「不认工具调用」引擎走普通对话;轮数耗尽交卷。
- **验收**:新套件(如 `selftest-agentloop.mts`)全绿;每个「只许一次」兜底都有「第二次不再触发」的断言。
- **依赖**:S1-1 的依赖注入方式(保持一致)。

#### S1-3 页签拖拽与 App 级行为兜底

- **对象**:`src/renderer/src/components/TopBarTabs.tsx:178-506 beginTabDrag`(329 行)、`src/renderer/src/App.tsx:64-863`。
- **改法**:优先把 `beginTabDrag` 里的纯计算(落点、插入位、跨组判定)确认已经走 `src/renderer/src/tabDragGeometry.ts`(手册「页签拖拽落点」条要求几何只走该文件,自测 `selftest-tabdraggeometry`);若 `beginTabDrag` 内仍有未抽出的计算,先抽出并补断言。App 级行为用现有 `test:journey` 兜底,在 PR 描述里列出 S3 拆 App 时要重点回归的 journey 用例。
- **验收**:`npm run test:tabdrag` 全绿且新增断言;journey 清单写进 PR。
- **依赖**:无。

---

### S2 合并重复(纯重构,不改行为)

每个子任务一个提交,提交后跑全链。验收中的 jscpd 命令见附录 B。

#### S2-1 tree-sitter 引擎初始化合一

- **现状**:`src/analyzer/index.ts:19-41` 与 `src/highlight/index.ts:30-46` 各自 `Parser.init`、各自 `sharedParser`、各自 `languageCache`,同一语法会加载两份(jscpd 克隆 `analyzer/index.ts:24-33 ↔ highlight/index.ts:37-46`)。两处取语法路径的写法也不同(`grammarWasmPath(...)` vs `join(grammarWasmDir(...), ...)`)。
- **改法**:新建一个共享模块(如 `src/native/treeSitterEngine.ts` 或 `src/parser/` 下,与 `src/native/wasmPaths.ts` 同层),提供 `ensureEngine()`、`loadLanguage(id)`(带缓存)、`parserFor(id)`;analyzer 与 highlight 改为调用它。query 缓存留在 analyzer。注意两者现在共用一个 Parser 实例是否安全(都在主进程单线程 await 链上,`setLanguage` 后同步 parse);合并后保持「每次 parse 前 setLanguage」。
- **验收**:`rg -n "Parser.init" src` 只剩 1 处;`npm run test:analyzer`、`test:highlight`、`test:depgraph`、`test:wasmpaths` 全绿;jscpd 不再报该克隆。
- **风险**:中低。打包路径(extraResources 的 wasm,`electron-builder.yml` 注释)必须不变,`test:wasmpaths` 兜底。
- **依赖**:无。

#### S2-2 通用小工具去重

- **现状**:
  - `clampInt`:`src/shared/uiWorkbench/page.ts:41`、`src/shared/uiWorkbench/node.ts:112` 各一份。
  - 通用 `clamp`:`src/renderer/src/marquee.ts:41`、`src/renderer/src/appearance.ts:90` 各一份。
  - `hexToHsl`:`src/renderer/src/components/Icons.tsx:55` 与 `src/shared/appearancePalette.ts:42`(已导出)重复;`Icons.tsx:72 hslToHex` 同文件。
- **改法**:新建 `src/shared/math.ts`(`clamp`、`clampInt`),各处改用;`Icons.tsx` 改用 `shared/appearancePalette.ts` 的 `hexToHsl`(如缺 `hslToHex` 就补到 appearancePalette)。业务语义的 clamp(`clampUiScale`、`clampDocZoom` 等)保留原名,内部可改用通用 clamp。
- **验收**:`rg -n "function (clamp|clampInt|hexToHsl)\b" src` 各只剩 1 处;相关自测(uiworkbench、appearance、marquee)全绿。
- **依赖**:无。

#### S2-3 IPC 样板收口

- **现状**:
  - `src/preload/index.ts:124-315`:「订阅 + 返回退订函数」写法手抄 10 次(`ipcRenderer.on(...)` 首处 :127,末处 :313)。
  - 主进程参数校验:`typeof rootPath !== 'string'` 出现 11 次;「参数不合法」在 6 个文件里共 15 处(`ipcShell.ts`、`agentChat.ts`、`fileEdit.ts`、`ipcEdit.ts`、`ipcModel.ts`、`ipcScan.ts`)。
- **改法**:preload 内部加 `function subscribe<T>(channel: string, cb: (p: T) => void): () => void`,10 个 `onXxx` 改为一行调用;`atlasApi` 的对外签名与 `AtlasApi` 类型推导不变(`preload/index.ts:318-321`)。主进程加 `src/main/ipcArgs.ts`:`requireString(v, label?)`、`requireRootRel(rootPath, relPath)` 等,替换重复校验,错误文案保持原样。
- **验收**:`rg -c "ipcRenderer.removeListener" src/preload/index.ts` 为 1;`rg -n "typeof rootPath !== 'string'" src/main | wc -l` ≤ 2;`selftest-appearance` 的 IPC 通道对账校验仍通过(手册「IPC 收发必须配对」条);typecheck 证明 `window.atlas` 类型未变。
- **风险**:低。注意 send/invoke 配对规则不能被改错。
- **依赖**:SEC-1(白名单校验可以并进 `requireRootRel` 的写入版本)。

#### S2-4 联网请求传输合一

- **现状**:`src/ai/weblookup.ts:113-127`(Node 版 POST,约 :88-140 为 Node 版 GET/POST)与 `src/main/aiEvidence.ts:77-91`(Electron `net.fetch` 版)几乎相同(jscpd 15 行克隆)。
- **改法**:写一个工厂 `makeJsonTransports(fetchImpl)`,Node 版传 `fetch`,主进程版传 `net.fetch`;超时、请求头、`HttpStatusError` 只写一份;User-Agent 用 S0-8 的常量。
- **验收**:jscpd 不再报该克隆;`test:ai`、`test:cloud`、相关 Tavily 自测全绿(都用 mock,不联网)。
- **依赖**:S0-8。

#### S2-5 两套右键菜单合一

- **现状**:`components/ContextMenu.tsx`(252 行)+ `contextMenuStore.ts`(80)与 `components/FilePathMenu.tsx`(282)+ `filePathMenuStore.ts`(97),共 711 行。定位函数 `clampedPosition` 两份(`ContextMenu.tsx:47`、`FilePathMenu.tsx:40`);点外关闭/Esc 监听(`FilePathMenu.tsx:137-139`)、「停一拍」常量(`ContextMenu.tsx` `LINGER_MS = 900`;`FilePathMenu.tsx` `COPY_LINGER_MS = 900`、`FAIL_LINGER_MS = 1600`)各一套。两者都处理「子窗渲染域隔离」。
- **改法**:分两步、两个提交:①抽公共底座(定位、关闭策略、跨 document 认领、linger),两边改用底座,行为不变;②评估 FilePathMenu 能否改为 ContextMenu 的一种菜单内容(备注编辑行、复制路径、在资源管理器显示)。第②步若牵动交互,停下来请人工确认,不强行合并。
- **验收**:`clampedPosition` 只剩 1 份;`npm run test:menudismiss`、`test:menuresize`、`test:notes` 全绿;journey 中右键菜单相关用例通过;手册「文件树备注」条描述的交互(回车保存、Esc 取消、失焦保存、空稿不误删)逐条手测并记录。
- **风险**:中。这是用户高频交互,视觉与手感不能变。
- **依赖**:S1-3(journey 回归清单)。

#### S2-6 平移缩放视口公共钩子

- **现状**:三套实现:`src/renderer/src/useImageViewport.ts`(237 行)、`src/renderer/src/uiWorkbench/useCanvasViewport.ts`(147)、`src/renderer/src/graph/useGraphViewport.ts`(252)。`useStageSize`(`useImageViewport.ts:136-155`)与 `useViewSize`(`useCanvasViewport.ts:74-93`)逐字相同;滚轮缩放各写一份。
- **改法**:先只抽 `useElementSize(ref, onSize)`(含「用元素所在窗口的 ResizeObserver」这一子窗约束)。滚轮/平移的公共部分在确认三者语义差异后再抽(看图以光标为中心 + 适应窗口;工作台平移 + Shift 横滚;图谱指数缩放),差异大就只共享底层工具函数。变换公式仍只走 `src/shared/imageZoom.ts`(手册看图条红线)。
- **验收**:jscpd 不再报 `useImageViewport.ts:136-155 ↔ useCanvasViewport.ts:74-93`;`test:image`、`test:imagezoom`、`test:graphview`、`test:uiworkbench*` 全绿。
- **依赖**:无。

#### S2-7 UI 工作台属性面板与设置页重复

- **现状**(jscpd):`uiWorkbench/FramePanel.tsx:57-81 ↔ RectPanel.tsx:214-238`(25 行)、`FramePanel.tsx:31-51 ↔ RectPanel.tsx:136-157`(21)、`LinePanel.tsx:128-146 ↔ RectPanel.tsx:262-282`(19)、`LinePanel.tsx:57-104 ↔ RectPanel.tsx:125-156`(3 处,16-17 行)、`ArtboardPanel.tsx:83-94 ↔ :121-132`;`newLineDefaultsStore.ts:28-38 ↔ newRectDefaultsStore.ts:25-35`;`ColorField.tsx:105-114 ↔ NumberField.tsx:57-66`;`SettingsAi.tsx:33-53 ↔ SettingsModel.tsx:45-65`(21 行);`AuxWindowShell.tsx:25-34 ↔ TopBarTabs.tsx:124-133`。
- **改法**:抽公共字段组 / store 工厂。UI 工作台的定位待人工确认(§7),**若确认不保留或要独立,本任务中的工作台部分暂停**。
- **验收**:上述克隆从 jscpd 报告中消失;tsx 重复率从 1.65% 下降(目标 ≤ 1.0%);相关自测全绿;界面截图对比无差异。
- **依赖**:§7 的 UI 工作台确认。

#### S2-8 其他同文件内重复(低优先)

- `src/ai/explain.ts:338-355 ↔ :415-432`、`src/renderer/src/useAiChat.ts:182-192 ↔ :205-215`、`:339-354 ↔ :420-435`、`components/RailAiStatus.tsx:100-111 ↔ :118-129`、`FreeChatComposer.tsx:327-336 ↔ :339-348`、`uiWorkbench/useCanvasTools.ts:149-158 ↔ :166-175`、`components/Icons.tsx`(:132-155 / :161-184 / :190-213 / :228-239 / :256-271,手写的整套 `<svg>` 组件)。
- **改法**:同文件内提公共函数。`Icons.tsx` 的 `IconArrowLeft/Right/Refresh/Folder/NotePen` 改用文件内已有的 `Line`(:246)或新的统一 `<LineIcon>`。可以并入 S3 对应文件的拆分。
- **验收**:总体 jscpd 重复率 ≤ 0.5%(基线 0.84%)。

---

### S3 拆巨型函数 + 函数行数闸

> 原则:每次拆分单独成提交,纯搬家不改行为;拆出块按职责归位(手册「单文件行数上限」条:共享逻辑进 `shared/`、界面件进 `components/`)。S1 的特征测试必须保持全绿。

#### S3-0 新增函数行数棘轮闸(先立闸,再拆)

- **改法**:新增 `scripts/selftest-funcsize.mts`(挂进 `test` 链),仿 `scripts/selftest-filesize.mts` 的棘轮写法:用 `typescript` 编译器 API(已在 devDependencies)遍历 `src/**/*.{ts,tsx}` 的函数声明 / 方法 / 箭头函数 / 函数表达式,行数 = 结束行 − 起始行 + 1;阈值 `MAX_FN_LINES = 150`;当前超限函数按「文件 + 函数名 → 基线行数」登记白名单,只许降不许升,降到阈值内提示除名。统计口径与附录 B.4 的脚本一致(**嵌套函数单独计,也计入外层**)。
- **验收**:首次提交时白名单恰好是当前 46 个超过 150 行的函数(附录 A.1 口径),套件全绿;故意把某函数加长会红灯。手册「开发约定」加一条「单函数行数上限」,与 filesize 条并列(同一提交)。
- **风险**:匿名回调的命名要稳定(建议用「文件 + 最近的具名祖先 + 序号」或起始行附近的调用名);改名或换行导致误报时,规则要能说清楚。
- **依赖**:无(可与 S1 并行)。

#### S3-1 `aiChat` 回调拆成管道

- **对象**:`src/main/ipcChat.ts:76-422`(347 行);`registerChatIpc` 整体 `:71-551`(481 行)。
- **改法**:按回调内已有的注释段落拆成顺序步骤,每步一个函数 / 小文件(可放 `src/main/chat/`):附件清洗(图片、文件)→ 题目兜底 → 能力闸(视觉、翻文件互斥)→ 联网查询与播报 → 人设与切片组装 → 预算规划(图片 / 文件 / 历史 / 引用 / 思考额度)→ 历史与压缩摘要 → 分流(普通对话 vs `runAgentChat`)。`registerChatIpc` 只剩注册。
- **验收**:S1-1 全绿;`ipcChat.ts` 内没有超过 150 行的函数;funcsize 白名单移除对应条目;`npm run test:chatmemory`、`test:contextbill`、`test:fileattach`、`test:chatimage` 全绿。
- **依赖**:S1-1、S3-0。

#### S3-2 `runAgentChat` 兜底策略拆分

- **对象**:`src/main/agentChat.ts:81-579`。
- **改法**:主循环保留「一轮请求 → 解析工具调用 → 执行 → 回填」;各个「只许一次」的兜底(提醒卡、质检闸、复读、紧急瘦身、4xx 撤卡、降级重答、封板)各自成为带状态的小对象或函数,由主循环按固定顺序询问。状态表集中成一个 `AgentRunState` 类型。
- **验收**:S1-2 全绿;`runAgentChat` ≤ 150 行;`test:agent`(Windows)/ 除已知平台断言外(Linux)全绿。
- **依赖**:S1-2、S3-0。

#### S3-3 主进程其余超长函数

- `src/main/appShell.ts:128-415 createWindow`(288 行):拆成「建窗 / 露窗看门狗接线 / 三个定时器(`:294` 模型轮询、`:300` 5 秒强制重画、`:316` 画面心跳看门狗)/ 托盘与 IPC 接线」。**定时器的行为与参数一律不改**(§7)。
- `src/main/ipcModel.ts:54-285 registerModelIpc`(232 行):按外观 / 货架与下载 / AI 配置 / 模型状态 / 选文件分成几个 `registerXxx`。
- `src/ai/builtinLaunch.ts:175-410 launchBuiltinServer`(236 行)、`src/ai/explain.ts:263-482 explainWithMessagesCore`(220 行)。
- **验收**:以上函数均 ≤ 150 行或有书面理由留在白名单;相关自测(`test:engine`、`test:launchplan`、`test:launchsettings`、`test:ai`、`test:window`)全绿;journey 通过。
- **依赖**:S3-0。

#### S3-4 渲染层巨型组件 / 钩子

按顺序(先易后难):

1. `components/ModelShelfPanel.tsx:115-514`(400 行)、`components/SettingsPage.tsx:50-420`(371)、`components/SettingsModel.tsx:25-293`(269)、`components/RailAiStatus.tsx:206-448 AiStatusPanel`(243):拆子组件 + 数据钩子。
2. `useAiChat.ts:80-475`(396)、`usePaneTabs.ts:24-474`(451):按请求生命周期 / 流式 / 取消 / 压缩,以及页签增删 / 分组 / 拆分拆成子钩子或纯 reducer(纯部分进 `paneTabs.ts`,已有 `test:panehost`)。
3. `components/FreeChatComposer.tsx:31-542`(512)、`FreeChatPanel.tsx:65-459`(395)、`CodePreview.tsx:57-447`(391)、`TabBar.tsx:52-410`(359)、`WorkspaceSidebar.tsx:23-374`(352)、`SourceEditor.tsx:29-333`(305,其中 useEffect `:96-307` 212 行)。
4. `components/TopBarTabs.tsx:100-607`(508,含 `beginTabDrag` 329):拖拽状态机独立成钩子,几何只走 `tabDragGeometry.ts`。
5. `App.tsx:64-863`(800 行,43 个 import,8 个 useEffect,7 处 `window.atlas`):按领域拆 Provider / 钩子(会话恢复已有 `useSessionRestore.ts`;页签、扫描、AI 设置、子窗、拖拽),App 只剩组合。

- **同时降耦合**:渲染层有 25 个文件直接调用 `window.atlas.*`(SettingsPage 9 处、RailAiStatus 9、useAiChat 7、App 7、EngineBackendPanel 5、translateStore 4、AuxWindowShell 4、AppTopBar 4)。拆组件时把 IPC 调用收进按领域划分的钩子或 service(如 `renderer/src/api/ai.ts`),组件不直接碰 `window.atlas`。
- **验收**:列出的函数都 ≤ 150 行或有书面理由;funcsize 白名单相应缩短;`rg -l "window\.atlas\." src/renderer/src/components | wc -l` 明显下降(目标 ≤ 5,PR 写实际值);journey 全绿;界面截图无差异。
- **风险**:中-高(交互状态多)。每拆一块跑 journey。
- **依赖**:S1-3、S3-0、S2-5(菜单)、S2-6(视口)。

#### S3-5 `shared/types.ts` 按领域拆分 + 解开循环依赖

- **现状**:`src/shared/types.ts` 644 行、51 个导出类型(interface/type),被 76 个文件引用。madge `--circular` 报 3 处循环:
  1. `shared/types.ts → shared/chatImage.ts`(`types.ts:5` 导入 `ChatImage` 类型,`chatImage.ts:5` 导入 `VisionSupport` 类型);
  2. `ai/agent.ts → ai/index.ts → ai/chat.ts`(`agent.ts:13` 从统一出口 `./index.ts` 导入**运行时**的 `splitThinking`、`sseEvents`;`chat.ts:15` 反向导入 `AgentChatMessage` 类型);
  3. `shared/uiWorkbench/scene.ts ↔ tree.ts`(`tree.ts:9` 导入 `SceneNode` 类型)。
- **改法**:types.ts 按领域拆成 `shared/types/scan.ts`、`ai.ts`、`preview.ts`、`window.ts` 等,原 `types.ts` 先保留为 re-export 出口(纯搬家),之后再逐步改调用方;`agent.ts` 改为直接从定义文件导入(不经 `ai/index.ts`);共享类型下沉到无依赖的 types 文件以破环。
- **验收**:`npx madge --circular --extensions ts,tsx --ts-config tsconfig.json src` 输出 0 个循环;typecheck 全绿。
- **依赖**:无(建议排在 S3-1 之后,减少冲突)。

#### S3-6 层边界小修

- `src/shared/paths.ts`、`src/shared/jsonFile.ts` 依赖 `node:` 模块(只被 main / ai / depgraph 使用),与「shared 两端通用」的定位冲突:移到 `src/main/` 或新建 `src/node-shared/`,并加一条 lint 规则(如 `no-restricted-imports`)禁止 `src/shared/**` 导入 `node:*` 和 `electron`。
- `src/parser/` 实际是语言识别(`identifyFileLanguage`,被 `scanner/index.ts:11` 使用),名不副实。是否改名(如 `langdetect/`)属于可选项;改名会牵动手册 scope 名与 graphify,**先请人工确认**。
- **验收**:`rg -n "from 'node:" src/shared` 无结果;新 lint 规则生效。
- **依赖**:无。

---

### S4 CSS 规范化与安全评估

> 硬约束:**像素级不变**。每个提交在 100% / 125% / 150% 缩放下抽查(手册「UI 改动自查清单」第 3 条),亮暗两套主题都看。

#### S4-1 样式按职责归位

- **现状**:
  - `src/renderer/src/assets/css/markdown.css`(951 行):1-325 是阅读档 `.md`,但约 `:326-:500` 是**右键菜单**样式(文件路径菜单 `:350`、窄身档 `:363`、行内图标槽 `:394`、开关行 `:407`、备注编辑行 `:414`、分区小标题 `:436`、组间细线 `:452`、aria-disabled `:464`、末尾 `:484`),另有 28 条 `.cm-host`(编辑器)规则。
  - `workspace.css`(747 行)混了侧栏、代码预览(`:218`)、虚拟滚动(`:260`)、阅读模式(`:375`)、配色角色(`:405`)、CodeMirror 编辑器(`:437` 起,另有 11 条 `.cm-host`)。
  - `free-chat.css:372` 的 iOS 拨钮与 `personalize.css` 的 `.cfg-switch` 重复(jscpd `personalize.css:163-174 ↔ settings.css:522-533`)。
- **改法**:按 `src/renderer/src/assets/main.css` 的 `@import` 体系新增 `context-menu.css`、`editor.css`、`code-preview.css`、`switch.css` 等,把规则搬过去。**`@import` 顺序就是层叠顺序**(`main.css` 第 1 行注释):搬家时必须保证同特异性规则的先后关系不变(`workspace.css:391` 注释说明了一处依赖加载顺序的覆盖关系)。
- **验收**:markdown.css 中不再有菜单类选择器;`.cm-host` 规则集中在一个文件;journey 截图与基线一致;css jscpd 克隆数 ≤ 3(基线 6)。
- **依赖**:S2-5(菜单合并后再搬菜单样式)。

#### S4-2 间距 / 字号收进 tokens

- **现状**:`tokens.css` 已有 `--space-1..8`(`:10-17`,0.25/0.5/0.75/1/1.25/1.5/2/3rem)和 `--font-*`、`--radius-*`、`--z-*`。颜色基本都已用变量(token 文件外只有 23 个颜色字面量,其中 `graph.css` 10 个)。但 padding / margin / gap 共 492 处,只有 135 处(27%)用了 `var(--space`;不在刻度上的高频值:`0.375rem` 63 次、`0.625rem` 42 次、`0.3125rem` 21 次、`0.125rem` 32 次。字号有 32 种写法(如 `0.78125rem` ×9、`0.85em` ×7)。`!important` 11 处(`workspace.css` 5、`markdown.css` 3、`tabs.css` 1 等)。
- **改法**:
  1. 恰好等于现有刻度的字面量直接换成 `var(--space-N)` / `var(--font-*)`(数值不变,零视觉变化)。
  2. 高频的非刻度值(0.375 / 0.625 / 0.3125 / 0.125rem)**新增**语义 token(如 `--space-1h`),不改数值。
  3. 加 stylelint(或一个简单的自测脚本)禁止新增裸 rem 间距,存量用白名单棘轮。新增 devDependency 需在 PR 说明理由;不想加依赖就用自测脚本实现。
- **验收**:间距变量覆盖率 ≥ 80%(统计命令见附录 B.5);字号写法种类 ≤ 15;视觉无差异。
- **风险**:中(量大,容易手滑改数值)。建议用脚本做机械替换并 diff 复核。
- **依赖**:S4-1。

#### S4-3 `sandbox: true` 评估(只出报告,不开启)

- **现状**:`src/main/atlasWindow.ts:16-24` 注释写「沙盒不开(preload 桥要够得着 Node)」。preload 里用到 `process.versions`(`preload/index.ts:75-79`)、`webUtils.getPathForFile`(:147-153),并从 `../shared/` 导入 `uiScale`、`localPrefs` 等模块(沙盒 preload 只能 require 有限模块,依赖打包产物形态)。
- **产出**:一份评估(写进 `docs/to-do list/`),列出开沙盒需要改的点、电子版本的限制、风险、工作量;**不改代码**。是否实施由人工决定(§7)。
- **依赖**:SEC 全部完成。

---

## 6. PR 切分建议

| PR                    | 内容                                                  | 说明                                                            |
| --------------------- | ----------------------------------------------------- | --------------------------------------------------------------- |
| PR-1 止血             | S0-1 ~ S0-4、S0-6 ~ S0-8(S0-5 见说明)                 | 纯配置、文案与一行级修复;**与安全分开**。合并后 CI 应恢复全绿。 |
| PR-2 安全             | SEC-1 ~ SEC-4(+ S0-5 README,如果选择与白名单同步发布) | 会改变运行时行为,单独审、单独可回滚;SEC-3(CSP)单独一个提交。    |
| PR-3 特征测试         | S1-1 ~ S1-3、S3-0(函数行数闸)                         | 只加测试与可测性搬家,不改行为;为 S2/S3 兜底。                   |
| PR-4 主进程/共享去重  | S2-1 ~ S2-4                                           | 风险低,自测覆盖好。                                             |
| PR-5 渲染层去重       | S2-5 ~ S2-8                                           | 涉及交互,需跑 journey;S2-7 的工作台部分视 §7 结论。             |
| PR-6 主进程拆巨型函数 | S3-1 ~ S3-3、S3-5、S3-6                               | 依赖 PR-3。                                                     |
| PR-7 渲染层拆巨型组件 | S3-4                                                  | 可再按 S3-4 的 1-5 小步拆成多个 PR。                            |
| PR-8 CSS 与评估       | S4-1 ~ S4-3                                           | 视觉不变,附截图对比。                                           |

每个 PR 描述写:做了哪些任务编号、验收命令输出、与附录基线的前后对比数字、在 Linux / Windows 哪种环境验证、已知未覆盖项。

---

## 7. 需要人工确认的事项(执行 Agent 不得自行决定)

1. **knip 疑似死函数**:`src/ai/weblookup.ts:316 webSearch`、`:405 fetchPageText`、`src/renderer/src/recents.ts:116 writeRecentProjects`、`src/shared/notes.ts:116 loadNotes`、`src/main/paths.ts:8 extOf`、`src/renderer/src/components/Icons.tsx:219 IconFolder`、`src/shared/uiWorkbench/scene.ts:146 hitNode`。knip 报这些「导出未被使用」,但可能在文件内部被用到,或被动态 / 字符串方式引用。**删除前必须逐个人工复核**,执行 Agent 只出复核清单(引用搜索结果),不删。另外 88 个未使用导出、110 个未使用导出类型可以去掉 `export`,但也要先出清单。`tree-sitter-wasms` 被报「未使用 devDependency」是误报(`electron-builder.yml` extraResources 在用),不得删。
2. **画面心跳看门狗的 reload 兜底**(`src/main/appShell.ts:316-329`,心跳停 10 秒以上就 `webContents.reload()`)及相关补丁(`src/main/index.ts:54` `app.disableHardwareAcceleration()`、`:62` 关 `CalculateNativeWinOcclusion`、`appShell.ts:300` 每 5 秒 `invalidate()`):**先不动,只记录**。风险记录:主进程或渲染层长时间阻塞(如主进程跑 tree-sitter 全仓解析,`depgraph/index.ts:303-318`、`ipcScan.ts:166`)可能误触发 reload,丢掉未保存的编辑。S3-3 拆 `createWindow` 时只搬家不改参数。
3. **UI 工作台的定位**:`*uiWorkbench*` 共 82 个文件、约 8,442 行,另有 `ui-workbench.css` 821 行,自测 3 套,约占 src 的 16%。README 与维护手册均未提及(只有 `docs/archive/UI框架-*.md` 方案)。是否属于本产品主线、是否要独立成模块或按需加载,需小葵决定;未决定前,S2-7 的工作台部分与任何「删 / 迁移」都暂停。
4. **`scripts/selftest-agent.mts:113-120` 的 Windows 路径断言**是否改成跨平台(按 `process.platform` 分支,或用 `path.win32` 显式测 Windows 语义)。未决定前不改。
5. **`sandbox: true`**:只做 S4-3 的评估,不直接开启。
6. **tree-sitter 解析移出主进程**(Worker / utilityProcess)与渲染包按需加载(当前单个 JS 2.53MB):性能项,不在本次范围,是否立项需确认。
7. **`src/parser/` 改名**(S3-6):会牵动 CHANGELOG scope 与 graphify,需确认。
8. 任何会改变用户可见行为的合并(如 S2-5 第②步把 FilePathMenu 并进 ContextMenu)碰到交互差异时,停下来确认。

---

## 附录 A 量化基线(基准 `1b1ed2b`)

### A.1 函数长度(TS AST 统计,口径见 B.4)

- 函数总数 3,735;超过 100 行 77 个;超过 150 行 46 个;超过 200 行 27 个;超过 300 行 16 个。

超长函数 Top 15:

| #   | 行数 | 位置                                                      | 名称                            |
| --- | ---- | --------------------------------------------------------- | ------------------------------- |
| 1   | 800  | `src/renderer/src/App.tsx:64-863`                         | App                             |
| 2   | 512  | `src/renderer/src/components/FreeChatComposer.tsx:31-542` | FreeChatComposer                |
| 3   | 508  | `src/renderer/src/components/TopBarTabs.tsx:100-607`      | TopBarTabs                      |
| 4   | 499  | `src/main/agentChat.ts:81-579`                            | runAgentChat                    |
| 5   | 481  | `src/main/ipcChat.ts:71-551`                              | registerChatIpc                 |
| 6   | 451  | `src/renderer/src/usePaneTabs.ts:24-474`                  | usePaneTabs                     |
| 7   | 400  | `src/renderer/src/components/ModelShelfPanel.tsx:115-514` | ModelShelfPanel                 |
| 8   | 396  | `src/renderer/src/useAiChat.ts:80-475`                    | useAiChat                       |
| 9   | 395  | `src/renderer/src/components/FreeChatPanel.tsx:65-459`    | FreeChatPanel                   |
| 10  | 391  | `src/renderer/src/components/CodePreview.tsx:57-447`      | CodePreview                     |
| 11  | 371  | `src/renderer/src/components/SettingsPage.tsx:50-420`     | SettingsPage                    |
| 12  | 359  | `src/renderer/src/components/TabBar.tsx:52-410`           | TabBar                          |
| 13  | 352  | `src/renderer/src/components/WorkspaceSidebar.tsx:23-374` | WorkspaceSidebar                |
| 14  | 347  | `src/main/ipcChat.ts:76-422`                              | aiChat 的 `ipcMain.handle` 回调 |
| 15  | 329  | `src/renderer/src/components/TopBarTabs.tsx:178-506`      | beginTabDrag                    |

其后:`SourceEditor` 305(`SourceEditor.tsx:29-333`)、`createWindow` 288(`appShell.ts:128-415`)、`SettingsModel` 269、`RectPanel` 253、`AiStatusPanel` 243、`useCanvasTools` 242、`launchBuiltinServer` 236、`registerModelIpc` 232、`explainWithMessagesCore` 220、`SourceEditor` 内 useEffect 212(`:96-307`)。

### A.2 文件行数 Top 20(src,ts/tsx/css/html;`wc -l`)

| 行数 | 文件                                               |
| ---- | -------------------------------------------------- |
| 951  | `src/renderer/src/assets/css/markdown.css`         |
| 951  | `src/renderer/src/assets/css/free-chat.css`        |
| 879  | `src/renderer/src/components/Icons.tsx`            |
| 865  | `src/renderer/src/App.tsx`                         |
| 860  | `src/ai/builtin.ts`                                |
| 821  | `src/renderer/src/assets/css/ui-workbench.css`     |
| 792  | `src/ai/agent.ts`                                  |
| 747  | `src/renderer/src/assets/css/workspace.css`        |
| 644  | `src/shared/types.ts`                              |
| 618  | `src/renderer/src/assets/css/settings.css`         |
| 607  | `src/renderer/src/components/TopBarTabs.tsx`       |
| 598  | `src/main/agentChat.ts`                            |
| 564  | `src/renderer/src/editor/markdownLive.ts`          |
| 551  | `src/main/ipcChat.ts`                              |
| 542  | `src/renderer/src/components/FreeChatComposer.tsx` |
| 514  | `src/renderer/src/components/ModelShelfPanel.tsx`  |
| 508  | `src/ai/explain.ts`                                |
| 477  | `src/renderer/src/useAiChat.ts`                    |
| 474  | `src/renderer/src/usePaneTabs.ts`                  |
| 474  | `src/ai/weblookup.ts`                              |

- src 总计约 57,440 行;CSS 27 个文件共 8,443 行(经 `assets/main.css` 的 `@import` 汇总)。
- `scripts/`(不受千行闸约束):`selftest-ai.mts` 2,123 行、`selftest-uiworkbench.mts` 1,500、`selftest-journey.mts` 1,312、`selftest-agent.mts` 952。

### A.3 重复(jscpd@4,命令见 B.1)

- 总计:46 处克隆,539 行,**0.84%**(词元 0.91%),共 448 个源文件。
- 分格式:typescript 0.56%(20 处克隆)、tsx 1.65%(18)、css 0.85%(6)、javascript 0.40%(2)。

### A.4 依赖结构

- madge `--circular`:**3 处**循环(见 S3-5)。
- 渲染层直接调用 `window.atlas.*` 的文件数:25。
- `shared/types.ts`:51 个导出类型,76 个文件引用。
- `src/shared/` 中依赖 `node:` 的文件:2(`paths.ts`、`jsonFile.ts`)。
- knip(配置见 B.3):0 个未使用文件;1 个未使用 devDependency(`tree-sitter-wasms`,误报);1 个未声明依赖(`@lezer/common`,2 处导入);88 个未使用导出;110 个未使用导出类型。

### A.5 CSS

- padding / margin / gap 声明 492 处,其中用 `var(--space` 的 135 处(**27%**)。
- token 文件外的颜色字面量 23 个(`tokens.css` 内 124 个);`var(--` 引用 1,661 次。
- 不同字号写法 32 种;`!important` 11 处。
- 同一选择器前缀分散:`.cm-host` 规则 39 条(workspace.css 11 + markdown.css 28)、`.code-reading` 20 条(workspace 3 + markdown 17)。

### A.6 构建与检查

- `tsc --noEmit` ✅;`eslint .` ✅(0 问题);`prettier --check .` ❌(3 个 .mts 文件)。
- `npm run build` ✅:`out/main/index.js` 404.33 kB、`out/preload/index.js` 18.33 kB、renderer JS 2,528.61 kB、CSS 212.23 kB。
- 自测:逐个运行 54 个套件(Linux + Node 24.22.0),53 个通过,`test:agent` 因 Windows 路径断言失败(`selftest-agent.mts:113-114`)。
- `npm audit`:全部依赖 9 个(8 moderate、1 high:vite);生产依赖 0 个。
- 类型安全:`strict: true`、`noUnusedLocals/Parameters` 开启;src 中 `any` 0 处、`@ts-ignore/@ts-expect-error` 0 处、`as unknown as` 2 处、`eslint-disable` 2 处(`useSessionRestore.ts:83`、`SourceEditor.tsx:306`)。
- 代码注释中「第 N 批」类历史编号 268 处(仅供参考,不在本次任务范围)。

---

## 附录 B 复现命令(在仓库外的导出副本或自己的工作分支里跑;Node ≥ 22.12)

```bash
# B.1 重复率
npx -y jscpd@4 src --min-lines 6 --min-tokens 50 --format "typescript,tsx,css" \
  --reporters json,console --output /tmp/jscpd --silent
# B.2 循环依赖
npx -y madge@8 --circular --extensions ts,tsx --ts-config tsconfig.json src
# B.3 死代码(knip.json 放在临时副本根目录,不要提交,除非决定正式引入 knip)
cat > knip.json <<'J'
{"entry":["src/main/index.ts","src/preload/index.ts","src/renderer/src/main.tsx","scripts/*.mts","electron.vite.config.ts","eslint.config.mjs"],"project":["src/**/*.{ts,tsx}","scripts/**/*.mts"]}
J
npx -y knip@5 --no-progress
# B.5 间距变量覆盖率(在 src/renderer/src/assets/css 下)
rg -oN --no-filename "(padding|margin|gap)[a-z-]*:\s*[^;]+" . | wc -l
rg -oN --no-filename "(padding|margin|gap)[a-z-]*:\s*[^;]*var\(--space" . | wc -l
```

B.4 函数长度统计脚本(审查所用口径;路径按实际调整):

```js
// node longfn.cjs —— 需要仓库 node_modules 里的 typescript
const ts = require('<repo>/node_modules/typescript')
const fs = require('fs'),
  path = require('path')
const root = '<repo>/src'
const out = []
function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (/\.(ts|tsx)$/.test(e.name)) scan(p)
  }
}
function nameOf(n, sf) {
  if (n.name) return n.name.getText(sf)
  const p = n.parent
  if (p && ts.isVariableDeclaration(p)) return p.name.getText(sf)
  if (p && ts.isPropertyAssignment(p)) return p.name.getText(sf)
  if (p && ts.isCallExpression(p)) return '<cb of ' + p.expression.getText(sf).slice(0, 40) + '>'
  return '<anon>'
}
function scan(f) {
  const sf = ts.createSourceFile(
    f,
    fs.readFileSync(f, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  ;(function v(n) {
    if (
      (ts.isFunctionDeclaration(n) ||
        ts.isMethodDeclaration(n) ||
        ts.isArrowFunction(n) ||
        ts.isFunctionExpression(n)) &&
      n.body
    ) {
      const s = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
        e = sf.getLineAndCharacterOfPosition(n.end).line + 1
      out.push({
        len: e - s + 1,
        f: path.relative(path.dirname(root), f),
        s,
        e,
        name: nameOf(n, sf)
      })
    }
    ts.forEachChild(n, v)
  })(sf)
}
walk(root)
out.sort((a, b) => b.len - a.len)
for (const o of out.slice(0, 25)) console.log(o.len, `${o.f}:${o.s}-${o.e}`, o.name)
for (const t of [100, 150, 200, 300]) console.log(`fns>${t}:`, out.filter((o) => o.len > t).length)
console.log('total', out.length)
```

执行完成后,请在最终 PR 或报告里给出附录 A 各项的「前 / 后」对比表。
