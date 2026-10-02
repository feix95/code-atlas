# CHANGELOG

## 版本说明(给用户看)

每个正式版本的几句话说明在这里。往下是开发流水,一行一条照实记,新记录往最下面加,格式与 commit message 同款:`<类型>(<范围>): <大白话说明>`,顺序就是时间顺序(越往下越新),不额外编号。

### 0.2.0 —— 第一个安装包版本(2026-09-16)

- 第一个提供 Windows 安装包的版本:到 [Releases](https://github.com/feix95/code-atlas/releases) 下载 `CodeAtlas-Setup-0.2.0.exe`,双击安装
- 这个版本里有什么:任意文件夹秒开的大白话代码地图、文件预览(VS Code 官方配色分色)、只读 AI 小探针(讲代码/找文件/翻译 Git 改动,绝不编造、绝不动你的文件)、项目关系分析(JS/TS)
- 已知边界:AI 功能需要先配一个本地模型(LM Studio 或内置引擎 + GGUF 文件);项目关系分析目前只认 JS/TS 族;仅支持 Windows x64

# commit要求表（务必遵循）

| 序号 | 要求                                                 | 具体说明                                                                                                                                                                             |
| ---- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | **格式固定为一行**                                   | `<类型>(<范围>): <大白话说明>`,类型只能从 `feat/fix/docs/refactor/chore/perf` 六种里选,和 `CLAUDE.md` 提交规范完全对齐,不额外造词。                                                  |
| 2    | **彻底去掉"第几锤"编号**                             | 不留编号、不留"(体验补完包·模块X)""(修复包·X)"这类自造标签。顺序=时间顺序,不需要额外索引。                                                                                           |
| 3    | **范围(scope)从功能模块里选,不是随便写**             | 参考项目实际模块起名:`core / scanner / parser / analyzer / depgraph / ai / git / ui / window / settings / appearance`。同一类改动范围要统一,不要一会儿叫 `ai` 一会儿叫 `assistant`。 |
| 4    | **只留"干了什么",根因只留一句、能省则省**            | 不需要"为什么"的完整逻辑链,只留一个关键词级别的根因(如"坐标系错位""GPU 缓存冲突"),没有明显根因的条目就不勉强加。                                                                     |
| 5    | **type 判断标准要统一,别乱选**                       | 新功能 = `feat`；修 bug = `fix`；不改行为的整理/换实现方式 = `refactor`；纯性能 = `perf`；依赖/配置/构建杂活 = `chore`。原文如果是"体验优化+新功能"混在一条里,拆成型判断更准的那个。 |
| 7    | **"补"类追加修订条目照样保留成独立一行**             | 紧跟在对应主条目后面,不合并、不因为去掉编号就搞丢这个"这是后续追加"的信息——可以在说明里用"补"或"追加修复"带一句。                                                                    |
| 8    | **未完成的条目保留 `[ ]` 复选框,已完成的不加复选框** | 原文里 `[ ]` 状态(如"AI 对话记录 + 追问")照旧保留未完成标记;已完成条目不需要复选框,直接是 commit 式一行                                                                              |
| 9    | **语气延续大白话风格**                               | 不换成书面语黑话,"卡死"就是"卡死"。                                                                                                                                                  |
| 10   | **自查:光看这一行能不能猜到具体改了哪块、为啥改**    | 猜不到就说明压过头,把关键词捞回来。                                                                                                                                                  |
| 11   | **一行最多两句,超出必砍**                            | 第一句说干了什么,最多再补一句根因或关键边界,到此为止。分号连环套、括号套括号、反馈原话、修复过程复盘一律不进 CHANGELOG——那些住在 commit message 里。                                 |

## 进度

- feat(core): 项目骨架搭建(Electron + React + TypeScript)
- feat(scanner): 目录扫描器,选文件夹出目录树 + 文件统计
- feat(parser): 语言识别器,后缀 + 内容嗅探出语言分布
- feat(analyzer): AST 结构分析,点文件看函数/类/接口/组件
- feat(depgraph): 项目关系分析,谁引用谁 + 最忙文件排行
- feat(ai): AI 人话解释,本地大模型讲文件是干嘛的
- feat(git): Git 修改翻译,本地大模型讲这次改了啥
- feat(ai): 讲解扩容,支持更多语言,无结构文件靠名字猜
- feat(ai): 内置本地模型,免配置流式显示
- fix(core): 全项目体检,修一批稳定性问题(异常重启/进程残留/竞态)
- feat(scanner): 全树速览,规则引擎给每个文件挂一句话标签
- fix(scanner): 修大文件夹卡死(嗅探限流,跳过二进制)
- feat(scanner): 分级扫描,修选 C 盘卡死,点哪探哪
- fix(scanner): 修分级扫描子树路径断链
- fix(scanner): 系统锁定目录老实说不让看,不谎报不存在
- feat(ui): 资源管理器式双栏布局,左树右详情
- feat(ui): 可拖分割条,宽度可调可记忆
- feat(ui): 地址栏,路径可输入粘贴直达
- fix(scanner): 系统占用文件统一报读不了,不报不存在
- feat(ai): 任何文件都能分析,靠文件头魔数认类型
- fix(ui): 按钮不因空输入变灰,缺什么提示什么
- feat(ui): 信号灯体系,红/琥珀/灰三级信息条
- feat(ui): 等待状态统一口吻
- refactor(ui): 设计 token 收拢(间距/圆角/字阶/阴影)
- feat(ui): 补齐键盘焦点与组件状态
- refactor(ui): 卡片家族与文案统一
- feat(ui): 微动效,尊重"减少动效"系统设置
- feat(ui): 空状态与引导优化
- fix(ui): 暗色模式硬编码颜色改语义 token
- refactor(ui): 工作台重构,选中详情与 AI 助手分家
- refactor(ui): 工作台重构,树与详情分层,五 Tab 化
- refactor(ui): 工作台重构,抽屉化 + 换新皮肤
- fix(window): 去掉窗外假桌面装饰层
- feat(window): 无边框自绘窗口
- feat(settings): 设置中心,外观自定(亮暗/配色/缩放)
- fix(window): 修高缩放下透明窗隐身,退回实底兜底
- fix(window): 补:透明窗仍隐身的病根是无边框下 ready-to-show 永不触发,改随创建直接露窗
- feat(ai): LLM 上下文升级,补喂完整路径
- feat(ai): 追问对话框,支持多轮上下文
- feat(ai): 可选联网识别(默认关)
- fix(ai): 补:修联网开关存不住,追问点名叫联网现在真查
- feat(ai): 自由对话 + Atlas 小探针
- fix(window): 定位圆角悬浮窗隐身真因(GPU 缓存冲突),修复
- [ ] AI 对话记录 + 追问
- refactor(window): 窗控按钮挪右上,符合 Windows 习惯
- refactor(appearance): 辅助色分配重做
- feat(settings): 缩放改连续滑条
- fix(ui): 修目录概览卡片间距叠一起
- fix(ui): 排查设置面板关闭钮热区错位
- refactor(ui): 界面缩放换根字号引擎
- fix(window): 修设置抽屉戳穿悬浮卡外壳
- refactor(appearance): 配色系统重做,预设与自定义分家
- feat(settings): AI 设置改自动生效
- fix(settings): 缩放滑条松手才应用,补齐触屏收尾
- feat(ui): 设置面板可收起成小把手,带橡皮筋回弹
- feat(ui): AI 助手卡加「去追问」,直达自由对话 Tab
- feat(ui): 示例问题点击直接发送,不用再手点输入框
- feat(window): 窗控圆点画上功能图标,最大化变还原双框
- refactor(ui): 界面贴满整窗,去透明裙边与悬浮阴影,四角圆角保留
- feat(settings): 设置改居中弹窗,三分区导航 + 草稿暂存/预览/应用
- fix(ui): 补:修配色卡对勾压字,右侧预留角标位
- feat(settings): 有未应用草稿时关设置先弹确认,不闷头丢
- fix(window): 修最大化还原图标双框叠糊,换标准错位画法
- feat(ui): 首页改成「这台电脑」盘符列表,logo 变回家键,版本号进设置
- fix(ui): 聊天区改三段式布局,流式回复自动跟滚 + 回底箭头
- fix(ui): 开场白状态输入栏也钉底,两态同一高度
- feat(git): AI 干活报告,整轮改动翻成三段式大白话 + 签名缓存
- fix(ui): git 报告入口补进根文件夹概览页
- refactor(ui): 抽屉系统整体退役,Git 账本和报告改右栏原地展开
- fix(ui): 修右下角白块(滚动条角块透明 + 放行卡片收窄)
- feat(ai): 功能定位「功能在哪」,项目带路人照地图指路,防编造对照真树
- fix(ai): 功能定位地图按 token 掐预算,装不下自动砍半重试
- feat(ai): 上下文自动探测 + 预算公式化,各通道看锅下菜
- feat(ui): 常驻模型状态栏,热身/就绪/出错五态可见,可取消卸载
- feat(ui): 热身改估价进度,按上次耗时估,没真数不编数
- fix(ai): 删加载 120 秒硬超时,就绪等待不再冤杀慢硬盘大模型
- feat(settings): 选模型当场量尺,显存/内存三色灯把关 + 引擎死因验尸
- refactor(ui): 状态栏改通栏,左边状态右边数据,进度条拉通整条
- fix(ai): 热身估价基准改最近 3 次成功均值,摊平冷读热读运气
- refactor(appearance): 主题色遮罩摘除,面板回归中性,明度加安全带
- refactor(appearance): 画布底色不再跟主题色,全 app 底色永远中性
- feat(window): 窗口尺寸和位置记住上回;修设置弹窗高缩放下被截半截
- refactor(appearance): 自定义配色色相饱和度明度全放开,字色改按对比度自动选
- feat(ui): 点 logo 回到「这台电脑」首页,没开项目自动变灰
- feat(ui): 首页加最近打开项目,盘符卡片认卷标和类型,回家重列盘符
- fix(ui): 盘卡片不认卷标,只留大写盘符字母
- feat(ui): 顶栏加后退/前进,浏览位置成一条线,按浏览器惯例去重剪线
- feat(ui): 状态栏加「忙」态,流式实时报 token 账(已读/已吐/速度)
- fix(ai): 流式看门狗重修,断线卡住保住半截回答,超时话术不再冤枉模型
- fix(ai): 模型量尺把上下文缓存算进去,绿灯不再说太大方
- feat(core): Developer 日志窗口,引擎原话和请求账目全透明(环形缓冲,零落盘)
- fix(window): 修开日志窗后模型状态广播喂错窗,系统弹窗改认准来叫它的窗
- fix(settings): 修「模型上下文」一打字就被夹回 512,落账挪到失焦
- feat(ui): 试做文件树大小账,小葵拍板不要,整体回收不留痕
- fix(scanner): 全树速览准头修补(字典缝隙/事实压过绰号/残账说至少)
- refactor(scanner): 一句话解释按三档词条规矩整体重写,同话降噪
- refactor(ui): 散装文案按词条规矩过一遍,术语统一,中文收尾
- fix(ui): 排版与无障碍小修(小字 10px 地板/过渡列明属性/读屏可听/删除 6 秒撤销)
- perf(ui): 目录树轻量虚拟化,几千行的目录不再一口气画完
- fix(ui): 一句话说明一律文字标注,emoji 不单独站岗(降噪撤回)
- feat(ui): 手动备注:给文件/文件夹写自己的话,200 条上限自动清孤儿
- feat(scanner): 词根词典,高频命名词拆词翻中文(GitFileStatus → git文件状态)
- feat(scanner): Markdown/txt 读开头标题,一句话说明亮真名
- feat(ai): 讲解喂文件头注释和主人备注,人设立硬规矩点名真实函数名
- fix(ai): 补:导出 SYSTEM_PROMPT,上一条的讲解自测不再报错
- refactor(ui): 顶栏按钮换线稿 SVG 图标,图标册开张
- refactor(ui): git 账本去彩色 emoji 换线稿,文案顺语法
- refactor(ui): 详情页 Tab 五改三,「修改建议」退役,结构与关系合并
- refactor(ui): 全 app 彩色 emoji 退役,统一灰调线稿 + 主题色点缀
- feat(ui): AI 回答有 MiniMD 排版,回答底部加复制/重试小钮
- feat(ai): 功能定位加十个类目直找,规则层确定性命中不赌模型
- feat(ai): 推荐问题按文件性质定制,规则层出题 + AI 预测,永不空场
- fix(ui): 补:类目卡与 git 门间距、复制反馈提速、备注小笔落笔动画
- feat(ai): 本地模型默认上下文 4096 → 16384,默认值三边共读一个数
- feat(ui): 代码预览骨架:右键进预览,左文本右小探针,二进制/超大有守卫
- feat(ui): 选中代码引用到对话,「代码老师」人设只讲选中的片段
- feat(ai): 预览对话的推荐问题随对话演进,聊过换追问真言
- feat(settings): 个性化设置(语气/特质/自订指令),全默认提示词逐字不变
- fix(settings): 补:个性化栏收尾,删重复说明,占位示例重排
- feat(ui): 预览选区加角括号与辅助色竖线,Ctrl+A 只选代码,顶栏复制全文
- fix(ui): 引用浮钮等选完再露脸,拖选不再被按钮搅局
- fix(ui): 预览顶栏钮改回本意「引用全文」,额度账三边共读
- feat(ui): 文件夹单击 = 选中 + 展开/收起一把抓
- fix(ui): 展开态的小三角换辅助色,一眼看出已展开
- fix(ui): 展开/收起小三角放大,热区收小不占行
- feat(ai): 思考型模型适配,快问快答默认关思考,自由对话加思考开关
- fix(settings): 修个性化设置存不住,每次保存任何设置都顺手清零
- feat(settings): 语气改三档人设(友善/专业/幽默),特质模块退役
- feat(ui): 聊天输入舱一体化,弹性 textarea 五行封顶 + 拨杆加行
- refactor(ui): 设置页「实时预览」小样退役,满屏即真预览
- feat(ui): 双击文件直接进预览,二进制也有说明不弹窗
- feat(ui): 聊天会话全 app 常驻,聊天中点文件只换参考资料不切台
- feat(ui): 聊天面板钉牢不随换文件重搭;文件可拖进聊天挂引用
- feat(ai): 引用额度改动态账,跟着上下文窗口走,穷保底富封顶
- feat(ui): 「新对话」钮,点了清空从头聊,记录零落盘
- fix(ui): 补:新对话钮改推荐胶囊同款,和推荐问题并排
- feat(ui): 新对话改常驻,开场白状态也在推荐排
- feat(ai): 翻文件模式:探针自己列名单读文件,沙盒加缰绳,只看不写
- fix(ui): 输入舱按钮排进文档流,文字不再钻按钮底下
- fix(ui): 修输入舱换行临界点跷跷板抖动,涨快缩慢
- fix(ai): 翻文件丢思考内容修复,接住 reasoning_content 字段
- fix(ai): 翻文件每轮收账主动报 token,状态条不再哑火
- fix(ui): 重复点同一个文件不再刷「参考资料换成了」灰字
- feat(ai): 翻文件模式改流式,思考边想边播,答案逐帧收
- fix(ai): 修引擎双胞胎启动撑爆内存,启动体收进单飞闸门
- fix(ui): 点主文件夹永不收起,只选中加保证展开
- fix(ai): 推荐问题加 500ms 驻留防抖,点得快不烧模型
- feat(ai): 锅快满自动压缩旧翻看记录成纸条(可解锁重读),读文件额度放宽
- feat(ai): 翻文件添 search_content 按关键词搜内容,找回「找不到 500ms」的场子
- fix(ai): 引擎不认工具调用时记黑名单降级普通对话,不再躺平报错
- refactor(ui): 探针干活步骤改左对齐时间线小样,和居中通知灰字分开
- feat(ai): 聊天输入框认 /compact 手动压缩,旧对话提炼成摘要卡,后续请求当背景记忆带上
- feat(settings): 上下文数值按引擎分家,内置认手填、LM Studio 认自动探测
- feat(chat): 外接 LM Studio 时思考开关悬停注明「管不着思考」,指路去 LM Studio 那边的模型设置调
- feat(chat): AI 提到的项目文件变可点链接,点了左边开预览,带行号直达那一行
- style(window): 模型热身的来回扫描进度条退役,信号灯呼吸+文案报话就够了(攒条落地)
- style(settings): 设置页分区换序,个性化挪到外观与阅读下面,智能辅助和高级选项连成一气(攒条落地)
- style(settings): 高级选项常开不再折叠,换模型是高频活不过路费不收了(攒条落地)
- feat(settings): 模型上下文上档位滑块(4k~128k,照模型出厂上限封顶)+ 可点刻度,输入框自由填写照旧,两边互通
- feat(settings): 上下文实时黑板账单 —— 照 GGUF 模型档案精算 KV 占用,加模型块头比显存内存,扛不住当场标红喊话
- feat(settings): 上下文实时黑板账单,照 GGUF 档案算 KV 占用,标红提醒扛不住
- fix(window): 画面消失自动重载(渲染层崩了接回)
- perf(chat): 流式吐字只重画 busy 那条消息,旧消息不动
- fix(window): 修画面消失(GPU 合成链断掉),禁用硬件加速改软件合成
- fix(window): 补:软件渲染仍隐身,关掉 Chromium 遮挡误判 + 强制重画心跳
- fix(window): 补:渲染管线停摆整页重挂自救,rAF 心跳断 10 秒自动重挂
- perf(chat): 聊天列表去掉 O(n²) 重试倒查,重试改一轮一次
- refactor(preview): 预览去掉按文件名强制重挂,内容/选区/滚动位就地复位
- feat(chat): 聊天推荐问题开关(关掉省一次模型调用)
- fix(chat): 修隐身真凶(MiniMD 正则变量被覆写成 null,炸整棵 React 树)
- fix(window): 补:画面心跳挪进 React 树内,看门狗真管得住白屏了
- fix(ai): 修改上下文档位不生效(引擎运行中改档位被静默吞掉)
- feat(chat): 推荐问题开关升级成总闸,文件预测一并归它管
- feat(ai): LLM 优化四件套:命中清单旁路直摆卡、工具结果后垫提醒卡、守则防自指、截断处标注不续写
- feat(ai): 复读机防线,反重复采样 + 流式监工掐流重答
- fix(chat): 修文件夹聊天文件链接点不动(漏传 fileLinks)
- feat(chat): 绿字文件链接右键复制真实路径
- feat(chat): 右键菜单加「在文件资源管理器中显示」,文件名同款菜单
- fix(preview): 修跳预览整窗闪一下(两扇挂载加淡入)
- refactor(file-detail): 文件关系搬进概览页最下面
- fix(file-detail): 关系模组 UI 改成独立模组,去重复标签
- refactor(file-detail): 结构 Tab 退役,零件清单搬进概览垫底
- feat(tabs): 页签地基,右栏页签化,单击临时/双击钉住,同文件复用同页签
- feat(tabs): 页签分三品类(概览/小探针/预览),右键勾选显示隐藏,勾法记本机
- feat(tabs): 页签分组拼装,右键挪组/拖拽换位,分割条调比例
- feat(tabs): 页签四连修: ①补回叉掉的跟随页签；②预览拆伴聊,探针可拖拼屏；③品类菜单选完自动收；④拖到中心分屏
- fix(tabs): 修拖动分屏后正文裂变(每组渲染块被原样复制两份,删掉重复的)
- fix(tabs): 修公用探针页签重复开(「有没有」查重从激活组扩到全部组,显式入口跨组点亮领过去)
- fix(tabs): 修全关页签后点文件生出两张概览(补齐和点亮并成一把 setState,不再各读旧账本)
- feat(chat): 「去追问」把概览 AI 卡解释好的那一轮搬进探针对话当垫底,追问接得上
- fix(chat): 修探针页聊天撑破窗,补 min-height:0 修复高度链
- fix(ai): 修换了参考资料模型却说没看见(资料提示贴着每轮问题走,资料卡自述改成「涉及它时以它为准」)
- fix(tabs): 修分屏分割条拖不动(flex:1 把内联 width 无视了,改传 flex 缩写定占比)
- fix(tabs): 修拖页签到另一组后源组亮空底板(激活指针没交接,当场落回剩下的末张)
- feat(menu): 文件右键菜单三处统一规格,补齐路径复制/资源管理器定位/备注操作
- feat(tree): 树里文件名换主题色(跟聊天绿字文件一家),文件夹保持素色;按数值推算,没实际截图确认
- feat(menu): 参考资料卡右键接入同款三件套,聊天绿字链接菜单补齐备注段——全 app 对着文件右键一个规格
- refactor(menu): 树的自绘右键菜单并入全局文件菜单,四处共用,自绘款退役
- feat(ai): 对话翻文件模式新增 web_search,共用「联网查证」开关(默认关)
- fix(ai): 修联网查询被维基弱关联内容截胡,加相关性把关+不对路自动换词再查
- perf(ai): 联网搜索智能分流(操作题走DDG、概念题走维基)+正文瘦身
- fix(ai): 修上下文爆锅没人救,探针聊天/翻文件模式补上紧急瘦身重试
- feat(ai): 翻文件模式加「先搜后答」质检闸+固定三步 SOP,治不搜文件瞎猜
- feat(preview): 文件预览语法高亮上线,色号照抄 VS Code 官方配色
- chore(build): 接入 electron-builder 出第一个 Windows 安装包——wasm 字典改走 resources 行李箱,web-tree-sitter 挪进 dependencies 进 asar
- refactor(appearance): 外观设置搬进主进程 appearance.json,根治「端口被挤外观变出厂」;localStorage 旧档首启自动迁移
- fix(git): 修 CI 短路径(8.3 短名)下子目录前缀算歪——仓库根与所选路径先 realpath 归一
- fix(git): 补:子目录前缀改由 git 自报(rev-parse --show-prefix),path.relative 大小写暗坑一并除,零猜态
- feat(ai): 模型货架上线——设置里逛抱抱脸实时 GGUF 榜(直连不通自动换镜像),大小/时间筛选+模态标签,超内存盖「带不动」灰戳
- feat(ai): 模型货架一键下载——断点续传拉 .gguf(双源+可取消),下完自动切内置引擎填好模型路径
- feat(build): 安装包换向导式安装,可选安装目录;README 补卸载与清理说明
- feat(build): 应用图标上线——「你在哪里」定位标换掉 Electron 出厂图;SVG 源+生成脚本入库,小尺寸加粗简化保 16px 不糊
- feat(ai): 联网搜索接入 Tavily 打头——设置新增 Key 填写框(免费档每月 1000 次);源队列统一 Tavily → DDG → 维基中 → 维基英,旧 source 分流退役
- fix(appearance): 修外观设置存不住、重启回出厂——preload 用 send 发、主进程只挂 handle 收,消息静默丢弃;改走 invoke 落盘,补 IPC 收发配对自测
- fix(ui): 设置「Tavily 搜索 Key」区块不再贴边,竖排留白同步补齐
- feat(ui): Key 输入框加小眼睛,点了显明文再点藏回去;图标跟「浏览…」实心钮区分开
- feat(ai): Tavily Key 加「测一下」与清洗——点一下真打官方接口按状态码说人话;保存/读档洗净引号与 Bearer 前缀,不像 tvly- 开头黄字提醒但不拦
- fix(ui): 修渲染层类型声明里 shared 引用路径多一级——skipLibCheck 静默吞掉,IPC 类型退化成 any
- fix(ai): 自由聊天历史窗口截错方向,旧问题粘在新问题前面导致小探针答旧题;改成从尾部留最近 3 对完整问答
- fix(ai): 质检闸管宽了,联网已答对还被逼重搜本地——门卫词表摘泛搜语气词、补救提醒封顶 2→1、纠错消息自报家门、对账放宽到文件名级
- fix(ai): 修 CI 连挂 5 锤——自测「全网断」场景漏改 options 新签名,fetchText 取不到回退真联网;补回 mock 注入,自测不碰网
- feat(ai): 「测一下」改打官方 /usage 用量接口——零搜索额度成本,200 即证 Key 有效并报本月用量;劫持页照样当「看不懂」不吹能用
- feat(ui): 模型货架行排版重做——名字做主角副行小字,文字胶囊换彩色能力章,行改 grid 定宽列对齐,「带不动」行降灰红章保饱和
- feat(ai): 货架数据层——不是文本打底的一律过滤,参数量级/量化翻译/底座协议就地解析;筛选偏好存 localStorage 下次照旧
- feat(ai): 新用户默认引擎从 LM Studio 外接改为内置——开箱即奔推荐模型,不再要求先装外部软件
- feat(ui): 货架面板大改——推荐模型一键下载卡、展开档案卡与量化灰字、分页加载更多、GSAP 三处点睛;按小葵设计稿定稿:大圆角内框/亮底选中章/推荐卡去框入列
- fix(ui): 模型设置页黄字重复报「有点挤」——静态量尺收声只留文件不存在硬警告,显存这笔账交给滑条下的实时账单
- feat(depgraph): 项目关系分析补齐多语言——Python 相对导入、Go 的 go.mod 前缀、Java 的 Maven 布局、Rust 的 crate/super/mod 全连上,连不上的老实记 unresolved 不硬连
- fix(ai): 修小探针答旧题——历史按轮成对收集,悬空旧题整轮扔;主进程补中间扫描兜底,当前问题钉注意力锚
- feat(window): 收起模式地基——单实例锁防双开,托盘常驻三件套,关窗改收进托盘不再整程序退出
- feat(window): 桌宠上岗——透明置顶小窗三态动画可拖可穿透,位置记忆托盘找回,点它唤回主面板
- feat(window): 资源管理器右键问一问——注册表菜单开关(设置页可拨,仅安装版),文件转交桌宠气泡开聊,项目外文件可一键切工作目录,文件夹右键直接打开,卸载清干净
- feat(ai): 划词问一问——任意软件选中文字按热键小探针弹气泡直接问,剪贴板抓完原样还;设置页可拨开关可录键,没抓到就完全无反应
- fix(ai): 修划词热键幽灵残留——换键/关闭后旧键还挂系统上偷发 Ctrl+C,改成记账精确摘上次注册的键;畸形档位入参改拒收不缝补
- fix(ai): 修引擎孤儿收尸盲区——死在加载阶段没监听端口的 llama-server 永远收不到尸,白占显存内存;改成 spawn 落 PID 档、退出删档、启动照档验明正身才收
- fix(window): 修桌宠摸不到——「在不在小家伙身上」改由主进程拿窗位置对屏幕坐标,光标离开补报;右键补上快捷菜单(唤主面板/藏桌宠/退出),桌宠页报错进日志
- fix(window): 拖动中锁实心修 bot 闪烁漂移——穿透开关不再乒乓,松手信号不漏;右键菜单第一项看主面板状态下菜,在屏上给「隐藏主面板」
- fix(window): 修桌宠藏起再叫回连锁病——真 hide 吞按下信号、setOpacity 假藏一拖变透明(合成链断档);藏起终版改「页面隐身+穿透」不碰窗,托盘右键按主面板/桌宠真实状态下菜
- fix(settings): 修设置页左导航高亮不跟滚——分区点名顺序把个性化/智能辅助抄反了,滚到第三块左边还亮第二块;改成按导航真实顺序点名
- feat(ui): 自由对话走出面板——「Atlas 小探针」页签拖出主窗或右键「放到桌面」变身桌宠,同一场对话主面板/桌宠/气泡三处共享,收回时页签原样飞回
- fix(window): 缩放屏上透明窗越挪越大越拖越漂——挪窗一律 setBounds 钉死尺寸(150% 缩放下裸 setPosition 每调一次窗体长 1px);气泡跟随降频成松手归位
- fix(core): 隔离项目切换的旧任务,打开地图不再等待修改记录;开发启动不误认自身文件,不再自动关闭其他模型进程
- feat(ui): 首页改成项目入门指引,导览用真实目录带路,随时一键回到项目全貌
- fix(ui): AI 未设置时直接带去配置,文件内容一键可读,打开失败和等待都有退路
- chore(core): 增加隔离的真实窗口流程自测,检查阅读、AI 引导、失败恢复与旧结果隔离
- fix(git): 非仓库自测用例自带向上查找边界,TMP 落进仓库里也不再误报
- fix(ai): 内置引擎缺失提示按版本指路,开发版指 vendor,正式版指重装和 LM Studio
- fix(ui): 桌宠气泡头摘掉 × 关闭钮,关窗走点桌宠或回主面板
- fix(ui): 页签右键放到桌面顺手把主面板藏进托盘(拖出那条路不动)
- feat(ui): 右键问一问和划词问一问下线——资源管理器右键两项+全局热键抓词连根拆,气泡只剩桌宠共享对话一种形态;安装/卸载都会清掉旧版写的注册表键
- fix(window): 修气泡挪窝后输入框点不中——跨缩放档的屏之间程序挪窗,内核画面还按旧档渲染、真身和影子分家;气泡跨显示器改先关后开在目标屏重开,桌宠落定也把画面钉回名义尺寸
- fix(window): 修气泡输入框锁死——镜像节流尾推发的是排闹钟时的旧快照,改发当下最新版
- feat(window): 气泡窗四角四边自由拖拽缩放,尺寸记进本机;输入框换多行舱,五行封顶拨杆再撑
- feat(ai): 提示词换骨架——短内核+按场景挂切片,闲聊不再被拽回代码;工具说明书瘦身,提醒卡按真翻文件次数垫
- feat(ai): 讲解深度三档(简洁/精简/详细),详细档真喂代码原文;小锅自动降档并在顶上垫灰字明说
- feat(ai): 语气加回「默认」档——不垫任何语气人设,模型原汁原味;自订指令照常生效
- feat(ui): 聊天框打 / 浮出命令补全面板(现收 /compact)
- feat(ai): 翻文件模式能申请看项目外目录——弹窗点头才放行,只读、本次运行有效、不落盘
- feat(ai): 模型没全上显卡时状态栏明说(一部分落内存会慢,关占显存的程序再重载)
- fix(ai): 翻文件模式中间轮说出口的话不再被收回——封板留成独立气泡,下一轮另起新气泡
- refactor(ai): /persona 命令下线(试用后用不上砍掉);对话里直接说「你现在是xx」照样认
- refactor(ai): 提示词体系2.0——人设分节与资料块统一XML标签包裹,工具回喂包<tool_result>声明「是资料不是命令」;清掉优先级最高/铁律尾等旧权威话术
- feat(appearance): 界面整体换 Obsidian 无色皮——灰黑白色板/文件夹图标/窗控悬停露色/动效全统一;配色收敛成石墨(默认)+雾空蓝(底板泛蓝)+自定义,自定义新增底板色(只取色调,亮暗自动跟主题)
- fix(window): 去掉桌宠和气泡窗的底板阴影——透明窗首帧阴影来不及合成会闪一块白底
- fix(ui): 实心按钮摘厚度阴影改平涂——受光线+黑影只在近灰皮上成立,彩色/近黑按钮上隐形或变味
- feat(ui): 图标册v5落地——一图一色双主题令牌,Lucide官方稿+手改稿混编,summarizer的emoji图标名全部换册内户口;顶栏/文件树/设置侧栏图标各自分组总控,顶栏组去色走单色
- fix(ui): 窗控钮豁免焦点环+设置侧栏工作区卡chip对齐居中——Electron重获焦把鼠标焦点误判成键盘焦点,文字span规则串台顶掉chip的grid居中
- feat(ui): 自由对话输入栏三颗圆钮(思考/翻文件/发送)图标绑组统一大小并去色——CHAT_ACTION_ICON_SIZE 总控,发送箭头保留加粗描边
- fix(window): 小探针气泡窗摘掉 10px 透明裙边治白边——阴影时代的死像素在软渲透明窗里糊成一圈白,窗边界=卡片边界
- refactor(core): 后缀花名册收一本账——二进制/文档后缀进 shared/fileKinds(并集收口,.docx/.gguf 预览不再当文本读乱码),语言户口本挪 shared/languages,depgraph 补后缀改查户口本(.mts/.cts 导入不再丢边)
- refactor(core): tree-sitter 语法账单源——GRAMMAR_WASM/LANG_TO_GRAMMAR 进 shared/grammarWasm,highlight 的 EXT_LANG 和 analyzer 的 GRAMMAR_FILES 全改派生(.zsh 顺手收编),WASM_OPTS 收进 wasmPaths

- refactor(core): 常量收口 shared——uiScale(缩放档位)/analysisLimits(解析上限)/aiDefaults(响应头·温度·附件上限·LM Studio 地址·上下文归一)各立户口;窗口下限/日志容量/引擎文件名/桌宠尺寸不再绕开常量
- refactor(core): 「带得动」判定系数进 shared/modelShelf(MODEL_FIT_*),货架判定/黑板账/量尺/悬停文案四面共表;HF 双源域名货架与下载共用一份

- refactor(window): 开窗样板收口 main/atlasWindow.ts——WEB_PREFS 安全开关四窗一副,露窗三保险(ready-to-show/首帧/看门狗)armRevealWatchdog 一处上弦,?view= 加载与视图名 VIEWS 统一对账

- refactor(core): AtlasApi 类型收口——preload 桥对象提 const atlasApi 再 expose,Window.atlas 声明改 typeof 推导(env.d.ts 120 行手抄镜像退役);ChatMessage 契约挪 shared/types;69 个 IPC 通道名收 shared/ipcChannels 总账(CH.*),收发 165 处全引总账,通道对账自测学会解 CH

- refactor(ai): 请求/探测底座收口 ai/http.ts——postChatCompletions 管控制器接力+响应头看门狗+POST 壳子(普通流式和 agent 不再各抄 25 行);friendlyHttpError/isContextOverflow 随迁;fetchWithTimeout+PROBE_*_MS 档位收编十处裸探测(LM Studio 状态/上下文/列模型/内置 health/HF 双源),流式看门狗三档进 shared/aiDefaults

- refactor(ai): formatGB 双胞胎灭门——户口收 shared/contextBill 一把尺,builtin 删掉本地复刻改引

- refactor(ai): 提示词标签总账 shared/promptTags(`TAG.*`)——拼装层 15 种 XML 标签全部引户口,旧常量(`COMPACT_SUMMARY_TAG`/`CURRENT_QUESTION_*`/`TOOL_RESULT_*`)转派生;"</compressed_summary>" 手抄闭标签和 chatContext 私养的附件上限一并收编;prompts.ts 逐字定稿文案不动
- refactor(ai): agent 工具名总账 shared/agentTools——五件工具名/ToolName/asToolName 认名闸/步骤播报词表一处登记,schema 定义与主进程分发链全引户口本;自测断言户口完整性

- refactor(ui): 三层预测内核收口 predictedQuestions.ts——LRU 缓存/竞态闸/请求壳一份,概览与对话两钩只留点火条件;拖拽 MIME 与载荷契约收 shared/dragTypes,收发两方全引总账

- refactor(ui): 设计令牌补课——字号档(--font-xxs/ml)/字重/行高/圆角/动效时长/层级/阴影/遮罩/窗控/switch/chip 全进 :root,45 处裸秒数与百余处裸字重行高清零;灰阶色板与外观种子色共源 shared/appearancePalette;桌宠绿配色收 --pet-* 一档

- refactor(ui): 图标册并一——SettingsDialog 私养的 ICON_PATHS+本地 Icon 退役,19 个图标迁入 Icons.tsx 总册(bot/folder 两处画法从此统一);内联尺寸裸值具名,输入舱拨杆图标进 inputMetrics

- refactor(core): 公共件收口——useFlashFlag「亮一下退场」与 useMenuDismiss「外点收摊」两钩收编七处抄板;输入舱 5/10 行阈值共 inputMetrics;存档读写两族出小件(渲染层 localPrefs/主进程 jsonFile+userDataDir);弹窗兜底 pickPathDialog 一处管;聊史双闸注释互指;气泡与桌宠的 px 尺寸按小葵拍板注为设计决定

- docs(handbook): AGENTS.md 更名交接文档-AI维护手册并全文重写为书面规范语——push 需小葵确认、攒条制废除、ZCode/CLAUDE 残留清理
- docs(handbook): 补维护与提交条款——AI 维护归属、自测脚本挂 test 链、CHANGELOG 定位开发日志
- docs(handbook): CHANGELOG 改全类型覆盖——docs/chore 随 commit 一律同步记,纯补记 commit 除外
- chore(test): 新增巨石棘轮闸 selftest-filesize——src/ 内单文件超千行红灯,登记巨石按基线只许瘦不许胖;手册 UI 文案与巨石条款同步修订
- chore: 全仓 prettier 大扫除——112 个文件排版归零、行为未动;巨石行数基线按折行后实际重登记,CHANGELOG 一处 `*` 通配符被排版误吞已用反引号赎回
- chore(ci): 新增 format:check 硬闸——CI 红灯拦格式漂移,commit 前跑 `npm run format`;大扫除 commit 登记 .git-blame-ignore-revs 抵消 blame 噪音
- docs(handbook): 巨石条款改写——明确 src/ 千行上限,拆分单独成锤、纯搬家不改行为、每锤全绿

- chore(test): 棘轮闸脚本术语对齐——'巨石'改'超限文件/单文件行数上限'
- refactor(ui): main.css 6508 行拆为 assets/css/ 13 件,原文件改 @import 索引——纯搬家,分段空行在拼接处还原,按序 join 逐字节一致
- refactor(ui): SettingsDialog 拆出 6 件——四分区(外观/个性化/智能辅助/高级)+OptionSelect/TavilyKeyField 归位 components/,主文件余 666 行只留壳与状态;JSX 逐字搬运零行为变化
- refactor(ai): ai/index.ts 1618 行拆为 8 个子模块(chat/webPrompts/explainPrompt/gitPrompts/locate/contextProbe/guessPrompts/explain),index 只留出口全量转出;estimateTokens 归户 shared/aiText.ts,逐字搬运零行为变化
- refactor(ui): App.tsx 2279 行拆为 10 件——scanTreeTools/paneTabs 纯工具 + useSidebarSash/usePaneTabs/useNavStack/usePreviewRefs 四域钩子 + AppTopBar/WorkspaceSidebar/PaneGroups/TabBody 四组件,主文件余 892 行只留状态接线与 JSX 壳;函数体逐字搬运,Provider 顺序照旧
- refactor(core): main/index.ts 3299 行拆为 12 件——paths/modelStatus/aiEvidence/agentTools/agentChat/appShell 六域后厨 + ipcShell/ipcScan/ipcModel/ipcGit/ipcChat 五段 IPC 登记 + registerIpc 调度壳,index 余 138 行只留启动生命周期;跨模块写经 setActivityProvider/setQuitting/disposeTray 三个 setter,其余逐字搬运零行为变化

- fix(shell): window.open 外链进系统浏览器前验协议——只放行 http/https/mailto,file:// 与畸形串一律拒开(项目体检黄灯 1)
- fix(core): 启动链挂 catch——startApp 在 ready 后早死时 console.error 留痕并 app.quit(),不再闷成无声僵尸进程(项目体检黄灯 2)
- docs(handbook): 超限文件首批五块拆完、白名单清空——闸口转拦新增(8371e60 补记,项目体检黄灯 3)
- docs(handbook): 新增根目录 AGENTS.md 承载红线、验证命令、dev 启动流程与文档索引,交接文档删去与全局记忆重复的条款和进度信息。交接文档不会被会话自动加载,红线只写在其中可能被跳过

- docs(ui-v3): 新增比例布局需求规格——顶栏盖头通宽/rail+侧栏+内容三列、Chrome 式页签、u 单位制、实色色号表;唯一功能变更=搜索升级为 workspace 文件名深搜

- docs(todo): 经典布局需求补录——背景由来(窗口底色之争)与后续路线备忘(实底窗口配方/Graph View 选型调研)

- docs(ui-v3): 规格销项定稿——盘符下钻「单击展开、双击打开」、workspace 卡改浏览器地址栏式、深搜含文件夹(点击开为工作区)、菜单 pin/历史去重且历史限 5 条、行内删除无撤销
- chore: prettier 补齐三份旧文档排版漂移(表格重对齐)——format 硬闸前的既有欠账
- feat(ui): UI v3 骨架与顶栏落地——顶栏整行盖头、第二层 rail+常驻侧栏+内容三列、u=4rem 与 chrome 槽位 tokens 就位;窗口尺寸改记 100% 基准值×scale,侧栏空态先上「这台电脑」盘符列表
- feat(ui): Chrome 式页签上顶栏——激活签白面反角融入正文/底细线断开、非激活签灰底顶角胶囊、页签带与分屏列一一对齐(分屏线上延)、等比收窄无「+」钮;拖拽/中键/右键/品类菜单全保留
- feat(ui): rail 落成——图谱钮开通单例占位页签(新 graph 品类不进品类菜单)、AI 状态三态图标(绿勾圈/蓝弧转/灰·红插头)+上弹浮层(供应商/进度/模型名/取消·卸下/AI 设置/日志全套),底部 ModelStatusBar 退役
- feat(ui): 侧栏按 v3 §7 落地——workspace 卡改地址栏式(点卡聚焦+⇅ 双态开收)、工作区菜单浮层(pin 区置顶多选+历史 5 条去重、行首 pin/pin-off 悬停显形、行尾 × 即删无撤销链)、树行 0.75u 摘三角同层左对齐、sash 悬停换 4px 粗蓝条
- feat(ui): 设置弹窗退役改单例页签——SettingsDialog→SettingsPage(左目录右内容/草稿应用确认全套原样),rail 齿轮无工作区也开、再点只聚焦不生第二张;设置签进保活层切走草稿还在,页签 ×/换工作区卸载即退预览;「AI 设置」各入口直达高级节
- feat(scanner): 工作区文件名深搜(UI v3 唯一功能变更):主进程递归扫盘,文件名和文件夹名含关键字即命中,沿用忽略名单与深度/节点保护闸;顶栏搜索框实时出扁平清单,文件点开预览(自动补探父链)、文件夹点开为工作区;防抖+双端 seq 顶旧账,上限 200 条,渲染层旧树内过滤退役
- feat(ui): 盘符下钻空态按 v3 §7.1 落地——「这台电脑」树区可逐层浏览:单击文件夹原地展开(browseDir 懒加载,渲染层不碰 fs),单击文件开「瞄一眼」预览签(新 peek 品类、scopeRoot 记盘根,不进工作区账本),双击文件夹/盘根开为工作区
- feat(ui): v3 深色对照定稿(§9.2)——chrome 七槽暗色值按 VS Code Dark+ 惯例转正(框架比内容亮一档);彩色主题下 topbar/panel/surface 三槽并入底板染色机关(paintSurfaces 同族泛色),无彩色回落样式表石墨值
- feat(ui): 锚值 --u 4rem→3.2rem(0.8 档)——顶栏高/rail 宽/收起钮列/AI 浮层锚位同缩,等式「顶栏高=rail 宽」继续成立
- feat(ui): 树行高改挂 calc(var(--u)*0.75)(=2.4rem,比原来 3rem 缩一档)——虚拟化占位同步,行距跟锚值自动走
- feat(ui): 树行高再压一档至 0.6u(=1.92rem,小葵实测两连缩定稿)
- fix(ui): 树行悬停不再出小手——.tree-main cursor 归箭头(行内容是「文本」,可点由 hover 底色表达)
- feat(ui): Ctrl+滚轮/Ctrl±0 缩放界面(浏览器惯例)——走 setUiScale 原路(落盘+根字号+窗口记账全跟上),滚轮 5%/档、触控板碎步积满一整档才翻;全局轻提示挪 .app 层,首页和设置页也报百分比
- feat(ui): 全局悬停轻提示单户口(新 TooltipHost,认 data-tip/#2c2c2c 圆角气泡/小尾巴/方位自动翻转)——原生 title 全场退役;文件树注释小灰字摘行挪进悬停提示(右侧出不挡上下行,备注只留笔帽标),侧栏三类清单统一右出,顶栏/rail/菜单等 80+ 处 title 统一换新样式
- fix(ui): 文件树轻提示统一锚树区右缘(sash 拖杆线)出,不再贴各文件名末端;气泡改 absolute 挂 .app 内——透明玻璃窗下根层 fixed 件会被合成器裁成隐形(命中活着像素为零),浮层一律走浮层正路
- feat(ui): 树行层级缩进减半至 0.5625rem/级(原 1.125rem 的 0.5,小葵实测定稿)——散五处的魔法数顺手收成 --tree-indent 单户口 token
- fix(ui): 文件名摘 60% 限宽帽子,吃到行右缘为止(当年给小灰字留座的规矩,退役后成死空间)——徽章/笔帽标照旧优先占座,名字只在他们到场时让位
- feat(ui): workspace 菜单加入盘根入口并统一行高/留白;侧栏与菜单底色、全局滚动条、分界线和开合图标动效按新规格对齐
- feat(ui): 文件树与盘符浏览保留彩色图标,其他界面图标统一为跟随主题的单色
- feat(ui): 微调 workspace 与顶栏搜索布局,侧栏图标点击热区收至可见底块
- feat(ui): chrome 基准 --u 3.2→2.5rem,内饰改挂 u 分数等比缩放;焦点描边全场摘除,图标点击区与可视底块统一;sash 扣 rail 宽的旧常量校正为 CHROME_U_REM
- feat(ui): 图标尺寸挂钩 rem 随界面缩放,侧栏/顶栏描边统一为 2;窗控三键弃 CSS 自绘改 lucide 图标并排成 1u 方格,刷新图标收至 22px;icon/padding/点击区术语口径录入维护手册
- feat(ui): 页签带空白可左键拖窗(IPC 增量搬窗,右键菜单与拖放落点照旧)并双击切最大化;概览页签换纸飞机,关闭钮改激活/悬停常驻钉右端、闲置签只留标题;分屏分界与正文共线(条带窗控补偿死值 9rem 改 3×--u);闲置页签透明、悬停吃 --chrome-hover;workspace 卡/菜单圆角归 --radius-xxs、菜单摘描边、双箭头收 1rem;收起侧栏改常驻挂载宽动画收 0,扫描完成右上浮层摘除
- feat(ui): 页签拖拽成系统(芯片态/让位缝/插入线/沉降/跨组/拖出放探针),拖拽期悬停提示压制+页签悬停提示摘除;顶栏/页签空白/日志头条统一手动搬窗(锁基线矩形治150%缩放下窗框偷长1px膨胀,摘app-region断根AeroShake);会话复现(atlas.session记工作区+选中节点+页签分组/顺序/激活/钉住/分屏比,开机重扫水合,死签丢弃孤组清场);钉住改可见拒绝(浮条+闪签)+右键菜单钉住明门;.app窗缘描边摘除
- fix(ui): 分屏预览超宽行顶穿容器(.workspace/.content补min-width:0断min-content传染),journey加宽行回归;feat(ui): workspace菜单常驻「我的电脑」回盘符列;feat(ui): AI状态卡加装载/换模型快捷道(modelLoad IPC),状态脸动效(彗星尾转圈/就绪勾弹晃+圈末尾淡入/卸下拔插头)绿系配色缩22px,样式独立ai-status.css;fix(ui): 页签插入线改寄生宿主签尾缘(Obsidian式治flex挤压坐标漂移),--drop-mark=sash蓝30%统一插入线/分屏虚线/sash悬停条;页签与预览头悬停提示摘除
- chore(ref): 参考素材入库——icon参考/ui概念/ui风格参考/v3稿约20MB,ref/ 摘 .gitignore 忽略改受跟踪
- feat(ui): 关系图谱页签替换占位页——资源管理器的图形视图(逐层进入,d3-force 力导向 + Canvas 2D 自绘),引用边归并到当前层子项、层外端点显示为虚线外部节点,悬停高亮/拖拽回弹/滚轮缩放/标签随缩放淡出,配色跟随亮暗主题,节点按钮清单支持键盘操作。新增 shared/graphView 纯函数与 selftest-graphview,journey 加图谱步骤,方案见 docs/to-do list《关系图谱-实施方案.md》
- docs: 关系图谱-全景模式方案入库(层级模式后续扩展方向,待实施);chore(ref): ui概念素材调整——摘psd补gif
- fix(ui): 激活页签补 Chrome 式外轮廓描边——顶/侧缘与双底角反弧同色 1px --line,顶栏底线在签身与镂空下断开并接弧尖;.tabbar 裁剪盒三向让位(overflow 裁在 padding 盒,首签左角反弧与签底线行原被切掉)
- feat(ui): 页签改版摘钉住——文件签绑死文件:树里点文件开预览签(一文件一签/重开激活旧签/文件夹只选中不开签/开项目空栏),概览/小探针/图谱/设置收为 rail 单例签;跟随换芯、钉住对话分家、品类勾选菜单与钉住保活层全摘,会话存档弃 pinned 字段(旧档钉签落成正常文件签)
- feat(ui): 页签撕窗 M1——页签拖出窗外/右键「移到新窗口」撕成无边框独立子窗(自绘标题栏+完整页签带+分屏正文,拖边缩放),同进程子窗+React Portal 活 DOM 整体搬家(对话流/滚动位不断),桌宠/气泡窗/freechatHost 全链退役,realm 铁律(ownerDocument.defaultView)落地
- fix(ui): 页签拖拽收口——源签拖拽全程原样不塌缩,失焦/切窗/松手丢 pointerup 自动取消(blur/visibilitychange/lostpointercapture/buttons 补票),正文中心「拆成两栏」落点撤除只留边缘定向拆;预览头「引用全文/退出预览」双钮与设置确认弹窗退役;全仓阴影收编 tokens(--shadow-menu/modal 并入 --shadow-pop 销户),拖拽芯片半透明无影
- feat(ui): 自由对话页改版——「Atlas 小探针」更名「自由对话」,探针形象退役(AtlasProbe 销户);整页网页式:顶行(参考 chip+新对话)/空场衬线问候+舱居中/620px 内容栏/一行胶囊舱(+|输入|发送);「+」菜单收思考/翻文件/联网三开关(iOS 拨钮,+ 旋 45° 变 ×,底边微压舱沿),联网直连 ai-config.webLookup 总闸;引用改文字流内嵌原子(message-square-code 图标+底色,光标顶头退格删整颗);思考行 Devin 式脑图标+流光「正在思考…」2px 弹跳点→「想了 Xs」chevron 旋 90° 展开;回答扁平无头像,动作条悬停露脸
- feat(ui): 预览折行+全窗实底+选中引用收口——预览头折行开关(md/markdown/mdx/txt/log 默认开,行块化+生成行号,5000 行以上禁用,选区行号改 data-line 直读);窗口透明壳退役,主窗/子窗/DevLog 全换主题实底(深浅联动 ipcModel 钩子,圆角与最大化特判摘除);选中引用出口收成右键菜单+选中直拖进对话舱(浮钮销户),首尾角括号改 caret 光标位钉选区边、Lucide brackets 拆半、icon 走 --sash-hi 实色与底色/竖线走 --drop-mark;FreeChatPanel 拆壳层+舱/气泡/便签三分,样式迁 free-chat.css,死样式摘除;通用右键菜单入库(contextMenuStore+ContextMenu,compact 窄身档/preferRight 正右侧出生),输入框右键复制/粘贴;占位字吃 --muted-2 并在引用在桌/拖拽悬停时隐身;拨钮开态染 --sash-hi(功能性强调统一走这 token,记进交接文档自查清单)
- feat(ui): 文件预览阅读模式+页签右键菜单改版——PaneTab 增 viewMode 户口(source/reading,sessionState 持久化+旧档兼容+非法值清洗,usePaneTabs.setTabViewMode 落签身随拖窗/挪组走),md 系文件签默认阅读档走 MiniMD 渲染(.code-reading 可读栏 max-width 居中+窄窗两侧收边),源码档原样保留折行/选区/行号全功能;页签右键迁全局 ContextMenu(Obsidian 式分组:关闭/看片档/挪组拆屏/文件动作,组间细线 MENU_SEP+行内图标+当前档行尾勾,菜单协议增 sep/icon/checked 位),「在文件列表中显示当前文件」回侧栏树选中+展开父链;分屏落点带放宽至左右各 1/3 屏全高判定,落点提示改整片 --drop-mark 半透明蓝平铺(虚线与提示字摘除);idle 页签间缝立 1px --line 竖分隔线(激活/悬停邻位不画),悬停改内缩圆角小板(签身透明只管热区);子窗窗控三键销户 aux-winbtn,统一吃 .win-ctl/.win-btn 同款 TreeIcon(WIN_ICON_SIZE 迁 inputMetrics 共享);journey 选择器跟进改名
- feat(ui): 缩放分工改版+杂修——Ctrl+滚轮改管文档字号(docZoom:--doc-zoom 乘 font-size 只缩预览正文,50%~300% 十档,localStorage 存档,.code-view 元素级监听天然 realm-safe,字号乘法不碰 zoom 属性保住虚拟滚动 computedStyle 账),界面缩放只吃键盘 Ctrl +/-/0(useWheelZoom 更名 useZoomKeys 摘除滚轮),缩放键监听提成 installZoomKeys 按窗装(子窗也灵),图谱画布白捡 Ctrl+滚轮/捏合缩放;菜单行禁用改 aria-disabled(原生 disabled 不吃鼠标事件,data-tip 会白挂),看片档两行文件签常驻、非 md 阅读档灰挂「Markdown 文件专属」tip(禁用优于隐藏);fix(ui): 输入舱文字被裁——border-box 下自动长高少算了上下 padding,height 补上 padY;feat(ui): 最大化态窗控换 restore 图标(lucide copy 水平镜像,旧四角 minimize 销户);feat(ui): 参考chip 资料卡点空白/Esc/外滚也收摊(useMenuDismiss 复用,ctxDoc 记卡片所在 document);journey 断言跟进:Ctrl+= 验界面缩放、预览区 Ctrl+滚轮验 docZoom 且根字号不动
- feat(ui): 阅读模式 Markdown 解析对齐 Obsidian——解析/描画分家:语法拆进纯数据 AST(src/shared/markdown.ts,parseMarkdown/parseInline),MiniMD.tsx 只画 React 元素;新增管道表格(分隔行认家|:--:/---:对齐+单元格吃行内语法+表内横滚不撑栏)、嵌套列表(缩进折树子表进父 li)、待办框([ ]/[x] 成真 checkbox 只读)、多行引用合并+递归块级、> [!type] callout(Obsidian 招牌,note/tip/warn/danger/quote 五色板落 token)、段落相邻行合并(软换行)、行内补 _斜_/_斜_(词内 _ 不斜,CommonMark)/~~删~~/==亮==;内联标题 title prop 摆文件名(Obsidian inline title 居中档);CSS:可读栏 overflow-wrap 断行兜底(治 |---| 长串横出界),标题四级换 em 级差(1.55/1.35/1.18/1.05,docZoom 跟着基字号免费走,摘逐级的 --doc-zoom 乘法),行内代码阅读档换 Obsidian 式主题色红字无盒;新增 selftest-markdown 登记进 test 链(表格/嵌套/待办/合并/callout/行内全家的账)
- fix(ui): 阅读档标题量级真生效——上一锤的 em 覆盖写在 workspace.css,与 markdown.css 的 .md .md-hN 同特异性但导入顺序靠前被闷杀(标题吃着正文同款字号);覆盖规则迁进 markdown.css 排在基础档后(同文件后写后赢),量级对齐 Obsidian 默认主题真值(1.8/1.6/1.37/1.25em)
- fix(ui): 阅读档行内代码去染色+疏密排版——RE_TAG_SPAN/codeNodes 染色退役(尖括号不再特殊,<xxx>整段同色,行内代码单色走 .md code),代码改 GitHub/Claude 款药丸(--hover 淡底+--muted 哑灰+等宽,padding 0.05em/0.3em 趋零+box-decoration-break:clone,折行两截灰底留缝不贴连;.md .md-h code 字号 inherit 不比标题小;.md-pre code 补 font-size:1em+color:inherit 治双重缩水);疏密排版变量集中 markdown.css 顶部 :root(--md-reading-lh/para-gap/li-gap/sublist-gap/h-gap/cell-pad 户口),阅读档正文行高 1.75、段落 0.9em、列表条目 0.4em、嵌套 0.25em、标题上 1.6/下 0.6em、表格单元格上下 0.5em,全部 .code-reading 锁域不碰聊天 .md
- feat(ui): md 默认阅读档+行内代码文件引用成链+阅读档页头摘除——fileTab 给 md 系签盖 viewMode:reading(开签即阅读,切档照旧落签身随存档走);resolveFileRef 整段判定进 fileLinks(行内代码恰是文件引用才成链,不扫子串,import a from x 这类带着别的字的不凑热闹;链接与原文字同款药丸皮,只留 --accent-bright 字色+点状下划线,hover 底变 --accent-line 转实线;悬浮 data-tip 摘除,右键菜单原样);MiniMD 抽出共享 fileLinkBtn;阅读档 .code-pane-head 整条隐去(文件名+折行钮是源码档家务),内联大标题接力;交接文档补成链约定;journey 断言跟进(.code-text→.code-reading×3)
- feat(ui): 设置页 Obsidian 化第二步+缩放失联修复——侧栏换脸成设置导航(文件树 hidden 保活不丢展开态/滚动位),设置改回四节连续滚动+滚动间谍回写高亮(到底强制末节兜底),sectionReq 等配置落账再跳(空壳期滚动会被内容撑高顶飞);Ctrl +/-/0 全局缩放广播接上设置页(uiScaleChanged:存档账永跟真实值,草稿账只在干净时跟);功能控件统一吃 --sash-hi(滑杆/档位条/拨钮开态);顶栏搜索/前进/后退/刷新在设置模式置灰;共享户口 settingsNav.ts+useSettingsNav.ts 钩收模式判定/跳转请求/收起态进出账;md 阅读档标题对齐业内档(h1~h6 2/1.5/1.25/1/0.875/0.85em,h5/h6 补样式户口),行内代码 0.85em、表格 1em,页顶文件名标题 2em 左对齐
- feat(ui): 页签关签体验+预览头开关组——连点关签冻结宽度(Chrome 同款:关签锁实测渲染宽,mouseleave 解冻,WAAPI FLIP 弹性回弹,320ms 过冲 ease),右键菜单新增「关闭其他页签/关闭全部页签」(usePaneTabs.closeTabsInGroup 一单算清,防循环单关的过期快照互踩);预览头新增「阅读/代码」快速开关钮(图标换脸 bookOpen/code,与右键菜单同一份 viewMode 账,页头两档共用一排,非 md 常驻置灰);换行钮改图标换脸标态(wrapText/textAlignStart,弃底色)+文字去掉;Tooltip 延迟改走 --tip-delay token(默认 0.3s,元素可局部改写,自定义慢档不走相邻接力),折行钮与工作区菜单钮挂 1s;代码预览字号 --font-xs 升 --font-base(与阅读模式同号 14px),预览头下沿发丝线摘除,「+」钮提示文案改「能力开关」;摘除聊天页「参考资料换成了」灰字垫条(顶行参考 chip 保留,chat.note 本体保留给真功能提示)
- feat(ui): 预览页头摘除文件名与文件图标——两档页头只留阅读/代码+折行钮右对齐,文件名右键菜单(复制路径/资源管理器/备注)随之退役,CodePreview noteMenu 与 TabBody editNoteFromTree 死链一并收编
- feat(ui): 预览页头钮组调尺寸——图标本体 1→1.2rem,可视底块/点击区 1.5→1.6rem(阅读/代码开关与折行钮共用)
- feat(ui): 树选中行摘竖条+树提示组接力+欢迎主页退役——选中态只留亮底与亮字(Git 改动行仍用 --edge-accent);树行提示走 --tip-delay-slow 1s 慢档,同组(data-tip-group=filetree)游走即时接力、组内缝隙不收摊,菜单钮/预览头钮的写死 1s 一并收编该 token;HomePage 销户,首开与回家直落 PaneEmptyBoard 空板,formatRecentTime 及自测断言、welcome 样式连带摘除,journey home() 改等空板
- feat(ui): 设置页 Obsidian 化定稿——侧栏四项改一页一导航(外观/AI 设置/联网与隐私/关于,滚动翻节与间谍退役),控件全家换稿定脸(下拉自绘箭头白底/中性描边钮/开关滑杆染色轨/圆形色珠+↻复位/?气泡钮/输入框统一等宽);草稿-应用账本整个摘除改即改即存(离散控件直落盘/文本 300ms 防抖聚合/上下文失焦归账/缩放滑杆松手才应用落盘/卸载冲线补写),页脚「应用更改」栏销户;设置模式侧栏钉 220px(sash 转静态),内容列 720px 居中,灰卡摘描边,行名/说明间距照稿,界面文案全角标点统一并逐句对齐定稿 mockup;模型货架收遮罩弹层(Esc/外点关,推荐位灰卡/筛选药丸换下拉/底脚稿注),OptionSelect/SettingsPersonal/SettingsAdvanced 销户,journey 导航断言跟进
- fix(ui): sash 拖拽橡皮筋卡感+侧栏底板统一为「一套规格只换内容」——f8aab50 给 .sidebar/.topbar-side 挂的无条件宽过渡在拖拽期被每帧 pointermove 重启,栏宽永远追不上鼠标;现 body.is-sash-dragging 期间摘掉两处的过渡(过渡只伺候收起/展开那一瞬);设置模式 --sidebar-w 220px 特判摘除,侧栏宽恒走文件树户口,sash 在设置模式恢复可拖/双击复位/键盘微调,.sash.is-static 销户;设置导航项字号抬 --font-ui-large(1.25rem)常规字重,.cfg-snav-item strong 的字号压制与粗体摘除,图标 NAV_ICON_SIZE 15→20 与字同高
- feat(ui): 页签拖拽换 Chromium 活序滑动模型——本组条带内源签真身 translateX 跟指针零延迟滑(夹持在本带首尾,z-index 压在补位邻居上),邻居在落点序号变化时 translateX±srcW 滑进腾出的格子,条带全程满编没有空位没有插入线;本带松手就地提交不飞沉降;指针出带/悬别家条带时胶囊芯片渐出跟手,别家仍走 margin 缝+插入线预览;滑位快照边界(slideMinL/MaxR)开拖时一记。.tabbar.is-dnd-live 过渡清单补 transform;源签 .is-drag-src transition:none 保跟手。fix(ui): 灭缝线规则误杀激活签左底角反弧——.is-dnd-live 的 ::before 灭口收窄回缝线本体选择器,激活签双弧拖拽中不再缺角
- refactor(ui): 自由对话顶行参考 chip 退役——资料附件照旧随选中项喂模型,只摘报幕牌(展开弹层/状态/右键口/prop 链一并收);「新对话」悬停提示换规范句式「清空当前对话记录,无法找回」,并入 --tip-delay-slow 1s 慢档
- feat(ai): AI 来源新增「在线 API」(OpenAI 兼容,预设 DeepSeek/Kimi/智谱/通义/硅基流动/OpenRouter/OpenAI/自定义),首次启用须隐私确认,Key 经 safeStorage 加密落盘,「读取模型」带 Key 兼任连接测试,401/402/429/5xx 翻成人话,上下文按选定档位(默认 32k)。本地两路请求与报错行为不变,新增 test:cloud 自测
- feat(ai): 在线 API 上下文档位放宽至 16k~1M 且可自由填写(默认 128k);服务商新增 Claude/Grok/Gemini、撤下通义千问与硅基流动,名单统一「产品名(公司名)」口径并按「国内→国际→聚合→自定义」排序
- feat(ui): 新增「UI 框架」页签 M0——rail 独立入口,组件墙(按钮 3 样式 × 5 状态 × 亮暗 + 卡片)与固定示例页在 iframe 里按规格包同款文档渲染,点选出手柄拖高度/内边距/圆角/图标尺寸(0.125rem 吸附 + 同族变量磁吸,Alt 自由拖,撤销/重做),lucide 图标选择器,一键导出规格包(README-给AI/页面骨架/tokens/reset/打包字体/组件与页面参考实现/DTCG design.json/字体加载后截图),导出前体检含糊词/写死数值/缺属性/演示代码泄漏/数据不一致即阻止;新增 test:uiframe 自测与 uiframe:compare 页面比对工具,规格见 docs/to-do list《UI框架-需求规格》。
- feat(ui): UI 框架 M1-a 组件配方扩充——组件改成注册表驱动(src/shared/uiFrame/recipes/,新增组件只需登记一份配方,组件 CSS/演示页/组件墙/README/体检自动跟上),新增图标按钮(3 样式 × 5 态 × 3 尺寸)、开关(内嵌/外凸 × 小中,真实 checked 属性)、复选框(方角/圆角/圆形 × 小中,勾号为 lucide 图标原文)、输入框(描边/填充/下划线 × 3 尺寸,前置图标槽)、页签(下划线/胶囊/分段 × 小中,选中走 aria-selected)、列表行(单行/两行 × 前置图标或头像 × 尾部箭头/开关/数值)、提示气泡(深浅色 × 有无箭头);变体差异用组件级自定义属性改绑变量实现,数值仍全部出自 tokens;体检「引用失效」改从全部组件/页面 CSS 收集变量定义,「状态缺失」支持每组件声明必需伪类;导出包每个组件一张预览截图。
- feat(ui): UI 框架 M1-b 变量板视图——画布第三视图(boardBody/boardCss,13 个基础变量分组排成色板/字号阶梯/间距尺/圆角/阴影等可视化小样,亮暗双拼色板),条目挂 tok:<名> 部件点选;属性面板新增单变量编辑(数字输入/亮暗取色器/阴影四分量/字体族文本),读数随提交原地刷新不重载 iframe;自测 +3(条目一一对应/读数/零写死),journey 补色板点选改值撤销回归

- feat(ui): UI 框架 M1-c 起步流程与我的方案库——开签先见起步页(选平台 → 4 个内置模板按平台过滤 + 空白起步 + 导入占位 + 我的方案清单);模板层 src/shared/uiFrame/templates.ts 以「默认变量表 + 每模板覆盖值」实现极简工作台/现代仪表盘(电脑)与色调圆角/留白清透(手机);方案库落 userData/ui-frame-schemes/<id>/(manifest.json+design.json+thumbnail.png+snapshots/),IPC 全套(列表/打开/保存/另存/重命名/复制/删除/快照列表/回滚/导出方案文件夹),方案 id 合法化与路径越界在主进程拦截;保存即落快照可回滚,缩略图走离屏截图;渲染层新增 schemeStore(起步态/户口 id/库清单/忙位)与起步页、方案库浮层、命名框组件;工具条加方案名入口与保存按钮;自测 +7(模板户口/覆盖值/四模板体检/序列化往返/清洗/id/manifest 与快照名),journey 覆盖起步选择与保存-重命名-复制-导出-删除-回滚全链。
- feat(ui): UI 框架 M1-d 方案导入——四条入口全通:我的方案库直接开、方案文件夹(选文件夹读 design.json 走 scheme 解析)、设计令牌 JSON(DTCG 风格 \/\ + com.codeatlas.uiframe 扩展,未识别变量跳过)、粘贴 CSS 变量(--名:值表逐条映射,var() 引用回接内部变量);新增 shared/uiFrame/importDoc.ts 纯解析层(颜色/尺寸/字号/字重/字体族/阴影分量归一化,未知变量与失败原因进战报);起步页导入卡 + 粘贴浮层(Esc 关),导入成功自动进画布并挂战报横幅(套用了 N 个/没对上的 M 个已跳过);回起步页时自动收起库面板与命名浮层;自测 +6(导出→导入往返一致、外部 DTCG、CSS 变量、阴影/字体族解析、方案文件夹、非法输入报错),journey 加导入全流程
- feat(ui): UI 框架 M1-e 手机端画布——设备预设注册表(devices.ts:桌面 1280/1440/1920 + 手机 360/390/430,含状态栏高/灵动岛/手势条/刘海参数);doc 增 device 字段随方案序列化往返,非法或跨平台 id 回默认档;画布手机端套机身外框(状态栏 9:41+信号组/灵动岛/底部手势条/两条安全区虚线,可开关)并定高内滚,桌面示例页可选窗口外框(标题栏+三圆点);定尺寸舞台改 width:max-content 后按内容宽缩放,修复适应宽度失效与桌面双投影;新增手机示例页 appPage.ts(导航栏/搜索输入/分段页签/列表行/CTA/底部页签栏,复用既有组件配方),documents.ts 按平台 pageFor 选页,导出包手机方案只出 pages/app.* 且预览截图按设备宽高;工具栏加平台/设备尺寸选择;自测 +5(预设计数/兜底回退/手机包文件与预览/design.json 设备往返/非法 id),journey 加切平台-外框三件套-安全区开关-换尺寸-切回桌面全链
- feat(ui): UI 框架 M1-f 平台规范实时校验——shared/uiFrame/platformRules.ts 按 §5.7 出分级提醒:点击区分平台(手机 44/电脑 24,引用链归集到末端变量去重)、文字对比度 ≥4.5 与控件边界 ≥3(亮暗两套,WCAG 对比度算法)、正文字号下限(手机 14/电脑 12)、焦点态两端查+悬停态仅桌面查(无交互组件豁免)、非步长数值(小数 px + 间距/圆角/控件/图标类离 0.125rem 网格,radius-full/描边/微调刻意值豁免)、变量断链报错;工具栏「规范」chip 带计数徽标,点开横幅面板列条目,点变量条目跳变量板选中该行;自测 +7(对比度算法/分平台阈值/豁免口径/状态门槛),journey 加手机端 44px 提醒与跳选验证
- feat(ui): UI 框架 M1-g 导出适配器与剪贴板——新 shared/uiFrame/adapters.ts 双生成器:Tailwind v4 @theme(七类归位命名空间 color/text/spacing/radius/font/font-weight/leading,余量原样落 @theme,ref 解字面值,暗色值写 [data-theme=dark] 块)+ React Native 主题对象 uiTheme(light/dark 分桶,尺寸出数值,字族出数组,阴影拆 offset/radius/spread/color);适配器落导出包 adapters/ 目录(避开 components/pages 体检扫描),README 文件索引同步;工具栏新增「复制主题」下拉,两格式一键入剪贴板,走 schemeStore.flash 横幅反馈,失败给降级提示;自测 +3(命名空间归位/ref 解析/暗色块、RN 结构与分桶、包内文件与体检零错),journey 补点菜单-读回剪贴板核对 @theme-横幅-关闭全流程
- feat(ui): UI 框架 M1-h 收口——自测 56→61:空白起步出包零错误、全模板×双平台 8 组合体检零错、确定性导出逐字节一致、README 文件索引与产物双向对应、图标槽位换图标包内文件同步换;journey 补空白起步路径(方案库新建方案→空白起步→组件墙渲染)与悬停提示抖动重试(scrollIntoView 的 scroll 补发会收掉 1s 慢档计时器);规格 §13.5 同步:RN 主题对象随 M1-g 提前落地,里程碑格 M3→M1
- feat(ui): UI 框架工作台外壳改造——侧栏换脸零件盒(组件/变量/风格/图标/我的方案五区,UI 框架签激活时替换文件树、关签原样还原,沿用设置页 uiframeMode 机制);画布新增 bench 底板视图设为默认(模板=示例页躺设备框,空白起步=真空底板+载入示例内容),视图更名底板/零件墙/变量板;零件盒点行跳转选中对应画布内容,风格卡一键套用模板变量(进撤销栈可 Ctrl+Z);工具条去黑话(规范→检查、导出规格包→导出给 AI 带说明、复制主题收次级菜单)并改双组自适应折行(窄窗动作组整体落第二行靠右,不再截断);新增 workbenchStore 管视图/定位/库浮层 UI 态;起步页加产品说明行;journey 补工作台验收段(零件盒渲染/文件树隐藏还原/底板默认/空白真空白/风格套用撤销);方案见 docs/to-do list/UI框架-工作台改造方案.md
- feat(quiz): UI 框架 M2-a 立项问卷数据层——新 shared/quiz 目录:§3.3 全部 29 题配置表(A~G 七组+条件显隐谓词)、§3.4 十二条推导规则表(配置驱动)、§3.5 立项单.md 生成器(五节结构+待 AI 建议项单列+待定项)、§3.7 技术栈预设清单、答案预填第二步映射(平台/风格模板/密度 2px 网格覆盖/品牌主色/D9 加强档);新增 test:quiz 自测(显隐/规则命中/立项单结构/预填换算)并入 test 链
- feat(quiz): UI 框架 M2-b 立项问卷向导——起步页加入口卡(开始/继续/查看草稿三态),全屏向导按 §3.2 每组一屏+进度条+上一组回改+条件显隐(A 组选手机才出 iOS/Android 题)+每题「不确定,让 AI 建议」+B2 填空+G3 色号补充输入;草稿自动存 localStorage 中途可关;完成页内嵌立项单预览+一键复制;Esc 收摊;journey 补开向导-条件显隐-ai 建议-走七组-复制-草稿续答-重答全链
- feat(quiz): UI 框架 M2-c 立项单三出口与技术栈回填——新 ipcQuiz + quizBriefSave 通道(showSaveDialog 存 .md 到用户自选位置);完成页加「存成 .md」「交给内置 agent」(新 quizBridge 事件桥,App 监听后切 chat 签把立项单当问句发出,探针忙垫灰字;附本机小模型质量提示);技术栈回填区(§3.7 预设清单 optgroup + 自由粘贴),随草稿存 localStorage;journey 补存盘落盘校验/回填/切签断言,dialog 替身补 showSaveDialog
