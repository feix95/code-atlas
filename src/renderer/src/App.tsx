import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  DepGraphResult,
  DriveInfo,
  FileStructure,
  FreechatHost,
  GitChangesResult,
  ScanDirNode,
  ScanFileNode,
  ScanResult
} from '@shared/types'
import { refreshNotesForScan, saveNotes, upsertNote, type NoteMap } from '@shared/notes'
import { isAiConfigured } from '@shared/aiSetup'
import { sanitizePersonalization, type TeachingLevel } from '@shared/personalization'
import { createMirrorThrottle } from '@shared/mirrorThrottle'
import { AiSetupContext, TeachingContext } from './aiSetupContext'
import { buildFileAttachment, buildFolderAttachment } from './chatContext'
import { ROOT_FONT_BASE_PX } from '@shared/uiScale'
import { FilePathMenu } from './components/FilePathMenu'
import { HomePage } from './components/HomePage'
import { ModelStatusBar } from './components/ModelStatusBar'
import { SettingsDialog } from './components/SettingsDialog'
import { Notice } from './components/Notice'
import { ProgressDots } from './components/ProgressDots'
import { AppTopBar } from './components/AppTopBar'
import { Rail } from './components/Rail'
import { TopBarTabs } from './components/TopBarTabs'
import { WorkspaceSidebar } from './components/WorkspaceSidebar'
import { PaneGroups } from './components/PaneGroups'
import { TabBody } from './components/TabBody'
import { cleanErrMsg } from './errText'
import { createRequestScope } from './requestScope'
import {
  forgetRecentProject,
  readRecentProjects,
  rememberRecentProject,
  writeRecentProjects,
  type RecentProject
} from './recents'
import { useAiChat, type ChatMessage } from './useAiChat'
import { loadChatSuggestionsOn, saveChatSuggestionsOn } from './chatPrefs'
import { useSidebarSash } from './useSidebarSash'
import { usePaneTabs } from './usePaneTabs'
import { useNavStack } from './useNavStack'
import { usePreviewRefs } from './usePreviewRefs'
import { useFlashFlag, useFlashValue } from './useFlashFlag'
import { useWindowMaximized } from './useWindowMaximized'
import { KIND_CAPS } from './paneKinds'
import { findDir, findFile, mergeStats, spliceSubtree, dirChainOf } from './scanTreeTools'

/** 共享对话快照的推送间隔(桌宠气泡锤):流式时每 100ms 最多糊一次 IPC */
const MIRROR_THROTTLE_MS = 100

/** 轻提示各养各的体感时长(P2-6 具名):不共用一张表,但每个数都得有名有姓 */
const REVIVED_MS = 15_000 // 复活横幅:画面断了被主进程重接回来,弹十几秒人话再自己退场
const SCAN_TOAST_MS = 4_000 // 扫描完成报个数
const PATH_HINT_MS = 5_000 // 空路径点了「前往」的气泡提示
const RECENT_UNDO_MS = 6_000 // 最近列表 ✕ 后的撤销窗(破坏性动作不裸奔)

function App(): React.JSX.Element {
  // 画面心跳(救生圈2.0,白屏案后搬家):从 main.tsx(React 树外)挪进树内 ——
  // 树活着心跳才跳;哪天渲染期异常把整棵树卸了(2026-09-13 的 MiniMD 隐身案就是),
  // 本 effect 的清账函数停掉 rAF,主进程看门狗 10 秒内发现心跳停摆,自动整页重挂救回。
  // StrictMode 下挂两遍也安全:每个实例只取消自己的那一跳。
  useEffect(() => {
    let lastBeat = 0
    let handle = 0
    const beat = (t: number): void => {
      if (t - lastBeat >= 1000) {
        lastBeat = t
        window.atlas?.frameHeartbeat()
      }
      handle = requestAnimationFrame(beat)
    }
    handle = requestAnimationFrame(beat)
    return () => cancelAnimationFrame(handle)
  }, [])
  // 首页盘符列表(第六十锤):一开就是「这台电脑」,只问有哪些盘,点哪个盘扫哪个
  const [drives, setDrives] = useState<DriveInfo[] | null>(null)
  const [drivesNote, setDrivesNote] = useState<string | null>(null)
  // 最近打开的项目(第八十一锤):存 localStorage,开过谁就记谁,首页一排卡片点回去
  const [recents, setRecents] = useState<RecentProject[]>(() => readRecentProjects())
  const [folder, setFolder] = useState<string | null>(null)
  // 地址栏草稿:跟着已打开的路径走,也能随手改成别的直接回车开图
  const [pathDraft, setPathDraft] = useState('')
  // 空路径点了「前往」:不禁用按钮,点了才提示缺什么(禁用灰在小白眼里像坏了)
  const [pathHint, flashPathHint, dismissPathHint] = useFlashValue<string | null>(null)
  const [pathShaking, setPathShaking] = useState(false)
  const pathInputRef = useRef<HTMLInputElement>(null)
  // 扫描完成的轻提示:报个数就自己退场,不挡路
  const [scanToast, flashScanToast] = useFlashValue<string | null>(null)
  // 救生圈的复活横幅(2026-09-13):画面断了被主进程重接回来时弹一句人话,十几秒后自己退场
  const [revived, flashRevived] = useFlashFlag(REVIVED_MS)
  useEffect(() => {
    const off = window.atlas.onRendererRevived(() => flashRevived())
    return off
  }, [flashRevived])
  const [result, setResult] = useState<ScanResult | null>(null)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 手动备注(第九十八锤):本项目 relPath → 小葵的一句话;存本机,存上限有孤儿清收
  const [notes, setNotes] = useState<NoteMap>({})
  // 树上右键「写/编辑备注」(第一百零二锤):指向要弹编辑框的 relPath
  const [noteEditRequest, setNoteEditRequest] = useState<string | null>(null)

  // 小探针寄居形态(走出面板锤):panel = 页签里;pet = 变身桌宠趴桌面。
  // pet 时那张公用场页签连卡带正房一起隐去 —— 页签就是桌宠,飞走了不留分身
  const [freechatHost, setFreechatHost] = useState<FreechatHost>('panel')

  // reveal 联动:激活页签/跳转目标在树里的父目录链,这些目录强制展开 + 滚到可见
  const [revealPaths, setRevealPaths] = useState<Set<string>>(new Set())

  // 选中就只选中 —— AI 永远等用户自己点;本地结构分析(不耗模型)仍随选中自动跑
  const [selectedFile, setSelectedFile] = useState<ScanFileNode | null>(null)
  const [selectedFolder, setSelectedFolder] = useState<ScanDirNode | null>(null)
  const [structure, setStructure] = useState<FileStructure | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  // 结构分析的票号:连点两个文件时,慢的旧响应回来不许盖新的账
  const analyzeSeq = useRef(0)
  const requests = useRef(createRequestScope())
  // 结构分析的提示分两色:info 随口一说(灰),error 真出事(红) —— 信号灯口径
  const [analyzeNote, setAnalyzeNote] = useState<{ text: string; kind: 'info' | 'error' } | null>(
    null
  )
  const [graph, setGraph] = useState<DepGraphResult | null>(null)
  const [graphLoading, setGraphLoading] = useState(false)
  const [graphNote, setGraphNote] = useState<string | null>(null)
  // 项目 git 总账:开图后顺手查一份(本地 git 命令,不耗模型),修改建议 Tab 和右栏 git 门共用
  const [gitInfo, setGitInfo] = useState<GitChangesResult | null>(null)
  const [gitLoading, setGitLoading] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsSection, setSettingsSection] = useState<'appearance' | 'ai' | 'advanced'>(
    'appearance'
  )
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null)
  // 讲解深度(教学三档):跟着 AI 配置走;档位一换,讲解钩子就把按旧档讲的旧账清掉
  const [teaching, setTeaching] = useState<TeachingLevel>('brief')
  // 推荐问题总闸(聊天偏好,存本机):关了聊天框上面和预览 AI 卡下面的推荐都不出,两处模型预测也一并省掉
  const [chatSuggestionsOn, setChatSuggestionsOn] = useState(loadChatSuggestionsOn)
  // 分级扫描:正被点开探测的目录 relPath + 探测失败的人话提示
  const [expanding, setExpanding] = useState<string | null>(null)
  const expandingRef = useRef(false)
  const [treeNote, setTreeNote] = useState<string | null>(null)
  // 顶栏搜索框的过滤词(UI v3 上移:B1 仍走旧的树内过滤,B7 换主进程深搜)
  const [treeFilter, setTreeFilter] = useState('')

  // 激活页签指向的文件节点(页签只存 relPath,树是户口本;重扫后节点没了就渲染兜底)
  // —— 预览页签改版后不再自带聊天,聊天上下文只认树里选中的对象,这个派生退役了
  // 公用场的聊天上下文:跟着选中的文件/文件夹走;什么都没选就聊项目根 —— 探针随时都在,不挑时候
  const chatContext = useMemo(() => {
    if (!result) return null
    if (selectedFile) return buildFileAttachment(selectedFile, structure)
    if (selectedFolder)
      return buildFolderAttachment(selectedFolder, selectedFolder.name || result.rootName)
    return buildFolderAttachment(result.tree, result.rootName)
  }, [result, selectedFile, selectedFolder, structure])
  // 翻文件模式(agent)的项目根从这儿递进去:沙盒只认这个目录,越界的活儿一律不接
  const chat = useAiChat(chatContext, result?.rootPath ?? null)
  // chatRef 两处用:气泡代发输入的订阅回调(永远调最新场次)、openFileLink 的稳定身份(MiniMD memo)
  const chatRef = useRef(chat)
  useEffect(() => {
    chatRef.current = chat
  })

  // 共享自由对话(桌宠气泡锤):公用场的消息流镜像给气泡窗 —— 全 app 一场对话,
  // 气泡只是它的另一扇门。快照节流 100ms:流式刷屏不逐 token 糊 IPC,间隔内的
  // 版本由尾推补 —— 补的必须是当下最新版(mirrorThrottle 记着的),旧实现补的是
  // 排闹钟那一刻的旧快照,「忙→完」翻牌被丢 = 气泡锁死案
  const mirrorNotify = useMemo(
    () =>
      createMirrorThrottle<ChatMessage[]>(
        (m) => window.atlas.freechatMirror(m),
        MIRROR_THROTTLE_MS
      ),
    []
  )
  useEffect(() => {
    mirrorNotify(chat.messages)
  }, [chat.messages, mirrorNotify])
  // 气泡代发的输入:正主永远是这边的公用场,气泡只是传话的
  useEffect(
    () =>
      window.atlas.onFreechatInput((payload) => {
        if (payload.op === 'send') chatRef.current.send(payload.text)
        else chatRef.current.cancel()
      }),
    []
  )
  // 小探针寄居形态(走出面板锤):panel = 页签里;pet = 变身桌宠。
  // 事实源在主进程,这边只听广播换装 —— pet 时页签栏和正房都不留分身,公用场账本照活
  useEffect(() => window.atlas.onFreechatHost(setFreechatHost), [])

  const folderRef = useRef(folder)
  useEffect(() => {
    folderRef.current = folder
  }, [folder])

  // 窗口壳:最大化时圆角描边要收掉;状态挂 body 上,抽屉(传送门挂在 body)跟着一起换装
  const maximized = useWindowMaximized()
  useEffect(() => {
    document.body.classList.toggle('is-maximized', maximized)
    return () => document.body.classList.remove('is-maximized')
  }, [maximized])

  // 开屏列盘符,之后每回退回首页(含 logo 回家)都重列一遍(第八十一锤):
  // app 开着的时候插的 U 盘、拔的移动盘,回家永远见得到;重列期间老列表照常摆着,不闪空
  useEffect(() => {
    if (folder) return
    let alive = true
    window.atlas
      .listDrives()
      .then((list) => {
        if (alive) {
          setDrives(list)
          setDrivesNote(null)
        }
      })
      .catch(() => {
        if (alive) setDrivesNote('盘符列不出来,在上方输入文件夹路径一样能开')
      })
    return () => {
      alive = false
    }
  }, [folder])

  // 扫描完成的轻提示:报个数就自己退场
  function flashToast(text: string): void {
    flashScanToast(text, SCAN_TOAST_MS)
  }

  // 统一的开图入口:清掉上一张图的旧账,再扫新路径;对话框选的和手输的都走这条。
  // 扫成的图递还给调用方(后退/前进恢复选中要在新树上找人);扫砸了回 null
  async function scanPath(dir: string): Promise<ScanResult | null> {
    requests.current.reset()
    const isCurrent = requests.current.begin('scan')
    expandingRef.current = false
    analyzeSeq.current += 1
    setAnalyzing(false)
    setGraphLoading(false)
    setGitLoading(false)
    setFolder(dir)
    setPathDraft(dir)
    dismissPathHint()
    setScanning(true)
    setResult(null)
    setError(null)
    setSelectedFile(null)
    setSelectedFolder(null)
    resetPaneTabs()
    setRevealPaths(new Set())
    setPreviewRefs([])
    setStructure(null)
    setAnalyzeNote(null)
    setGraph(null)
    setGraphNote(null)
    setExpanding(null)
    setTreeNote(null)
    setGitInfo(null)
    setNotes({})
    setTreeFilter('')
    try {
      const scanned = await window.atlas.scanFolder(dir)
      if (!isCurrent()) return null
      const root = scanned.rootPath
      setResult(scanned)
      setFolder(root)
      setPathDraft(root)
      // 备注跟上新树:顺带清孤儿(垃圾不越攒越多),再写回本机
      setNotes(refreshNotesForScan(root, scanned.tree))
      // 画成了一张图才算「打开过」:记进最近列表,下次首页一点就回(第八十一锤)
      setRecents(rememberRecentProject(root))
      // 换了地方就是新的一站(第八十三锤);同路径的刷新不算搬家,不记
      if (root !== folder) pushNav({ folder: root, file: null, dir: null })
      flashToast(`扫描完成:${scanned.stats.fileCount} 个文件`)
      // git 总账顺手收一遍(本地 git 命令,不耗模型):失败就当没有,不算错误不弹红
      setScanning(false)
      setGitLoading(true)
      void window.atlas
        .gitChanges(root)
        .then((info) => {
          if (isCurrent()) setGitInfo(info)
        })
        .catch(() => {
          if (isCurrent()) setGitInfo(null)
        })
        .finally(() => {
          if (isCurrent()) setGitLoading(false)
        })
      return scanned
    } catch (err) {
      if (isCurrent()) setError(cleanErrMsg(err))
      return null
    } finally {
      if (isCurrent()) setScanning(false)
    }
  }

  async function handlePick(): Promise<void> {
    const dir = await window.atlas.pickFolder().catch(() => null)
    if (dir) await scanPath(dir)
  }

  function openAiSettings(): void {
    setSettingsSection('advanced')
    setShowSettings(true)
  }

  useEffect(() => {
    let alive = true
    void window.atlas
      .aiConfigGet()
      .then((c) => {
        if (!alive) return
        setAiConfigured(isAiConfigured(c))
        setTeaching(sanitizePersonalization(c.personalization).teaching)
      })
      .catch(() => {
        if (alive) setAiConfigured(false)
      })
    return () => {
      alive = false
    }
  }, [])

  // 刷新 = 把当前项目重扫一遍;没开项目就点了,告诉他缺什么,按钮不装哑巴
  async function handleRefresh(): Promise<void> {
    if (!folder) {
      flashToast('先打开一个项目,再刷新')
      return
    }
    if (!scanning) await scanPath(folder)
  }

  // 空路径点了「前往」/回车:聚焦 + 轻晃 + 气泡提示,几秒后自己消失
  function setShakeAndHint(): void {
    setPathShaking(true)
    flashPathHint('先填个路径,或点「打开项目」选一个', PATH_HINT_MS)
    pathInputRef.current?.focus()
  }

  // 地址栏回车/点「前往」:直接开输进来的路径;粘来的路径常带首尾引号,顺手剥掉
  async function goPath(): Promise<void> {
    if (scanning) return
    const dir = pathDraft
      .trim()
      .replace(/^"+|"+$/g, '')
      .trim()
    if (dir === '') {
      setShakeAndHint()
      return
    }
    await scanPath(dir)
  }

  /**
   * 树里单击文件(小葵拍的规矩:单击就是换内容):选中它,右栏跟随页签全体转向它;
   * 激活的页签要是钉着,新内容就额外开一张新页签。本地结构分析照旧自动跑(不耗模型)。
   */
  async function followFile(file: ScanFileNode): Promise<void> {
    const seq = ++analyzeSeq.current
    pushNav({ folder, file: file.relPath, dir: null })
    setSelectedFile(file)
    setSelectedFolder(null)
    setStructure(null)
    setAnalyzing(false)
    // 公用场垫字(第一百二十四锤老规矩):聊着东西换资料,垫一句「换成了」;点同一个文件不垫
    if (chat.messages.length > 0 && selectedFile?.relPath !== file.relPath)
      chat.note(`参考资料换成了 ${file.name}`)
    retargetFollowTabs(file)
    // 激活页签的品类这个文件用得上就保持,用不上(如钉着的预览)落回概览;
    // 补齐和点亮一把过,概览不会生两张
    const kind =
      activeTabObj && KIND_CAPS.file.includes(activeTabObj.kind) ? activeTabObj.kind : 'overview'
    ensureFollowTabs(file, kind)
    if (result) setRevealPaths(new Set(dirChainOf(result.tree, file.relPath)))

    if (!file.language) {
      setAnalyzeNote({
        text: '暂时不能列出这个文件的内部结构。可以直接查看文件内容,或让 AI 解释。',
        kind: 'info'
      })
      return
    }
    setAnalyzing(true)
    setAnalyzeNote(null)
    try {
      // 路径契约:renderer 只回传 (rootPath, relPath),拼绝对路径是主进程的事
      if (!result) return
      const fs = await window.atlas.analyzeFile(result.rootPath, file.relPath, file.language.id)
      if (seq !== analyzeSeq.current) return // 用户已经点了别的文件,这份旧账作废
      if (fs) {
        setStructure(fs)
      } else {
        setAnalyzeNote({
          text: '暂时不能列出这个文件的内部结构。可以直接查看文件内容,或让 AI 解释。',
          kind: 'info'
        })
      }
    } catch (err) {
      if (seq !== analyzeSeq.current) return
      setAnalyzeNote({ text: cleanErrMsg(err), kind: 'error' })
    } finally {
      if (seq === analyzeSeq.current) setAnalyzing(false)
    }
  }

  // 树里点文件夹:选中出概览,页签规矩同文件;箭头管展开,点名字不触发扫描
  function followDir(node: ScanDirNode): void {
    analyzeSeq.current += 1
    setAnalyzing(false)
    if (node.relPath === '') {
      showProjectGuide()
      return
    }
    pushNav({ folder, file: null, dir: node.relPath })
    setSelectedFolder(node)
    setSelectedFile(null)
    setStructure(null)
    setAnalyzeNote(null)
    // 聊天中点文件夹(第一百二十四锤老规矩):只换资料不抢台 —— 探针页签本来就没动,垫字即可
    if (chat.messages.length > 0 && selectedFolder?.relPath !== node.relPath)
      chat.note(`参考资料换成了 ${node.name || result?.rootName || '这个文件夹'}`)
    retargetFollowTabs(node)
    const kind =
      activeTabObj && KIND_CAPS.directory.includes(activeTabObj.kind)
        ? activeTabObj.kind
        : 'overview'
    ensureFollowTabs(node, kind)
    if (result) setRevealPaths(new Set(dirChainOf(result.tree, node.relPath)))
  }

  async function handleLoadGraph(): Promise<void> {
    if (!result) return
    const isCurrent = requests.current.begin('graph')
    const root = result.rootPath
    setGraphLoading(true)
    setGraphNote(null)
    try {
      // 路径契约:renderer 只递 rootPath,图里的节点全是主进程算好的 relPath
      const depGraph = await window.atlas.depGraph(root)
      if (!isCurrent()) return
      setGraph(depGraph)
    } catch (err) {
      if (isCurrent()) setGraphNote(cleanErrMsg(err))
    } finally {
      if (isCurrent()) setGraphLoading(false)
    }
  }

  // 关系卡/概览推荐点路径跳转:在扫描树里按 relPath 找到文件节点,走同一条跟随链路;
  // 文件找不到再找目录:功能定位指中「整个功能住在这个文件夹」时也能跳
  function jumpTo(relPath: string): void {
    if (!result) return
    const found = findFile(result.tree, relPath)
    if (found) {
      followFile(found)
      return
    }
    const dir = findDir(result.tree, relPath)
    if (dir) followDir(dir)
  }

  // 点文件夹名称:只选中,出静态概览;展开/收起是箭头的活,扫描只由展开触发。
  // (followDir 在上面,和文件共用一套页签规矩)

  // 后退/前进回到「没选中」的一站:选中清空,概览页签回项目主页(它的零状态)
  function clearSelection(): void {
    analyzeSeq.current += 1
    setAnalyzing(false)
    setSelectedFolder(null)
    setSelectedFile(null)
    setStructure(null)
    setAnalyzeNote(null)
    ensureKindTab('overview', null)
  }

  function showProjectGuide(): void {
    if (!result) return
    clearSelection()
    pushNav({ folder: result.rootPath, file: null, dir: null })
  }

  // logo = 回「这台电脑」(第八十锤,小葵拍板):开到多深的项目,一点就退回选盘首页;
  // 上次开的路径留在输入框里,想回这个项目点「前往」就行。没开项目时按钮自己变灰
  function goHome(): void {
    if (!folder) return
    requests.current.reset()
    analyzeSeq.current += 1
    expandingRef.current = false
    setAnalyzing(false)
    setScanning(false)
    setGraphLoading(false)
    setGitLoading(false)
    pushNav({ folder: null, file: null, dir: null })
    clearSelection()
    setGroups([])
    setActiveGroupId(null)
    dismissTabFlash()
    setRevealPaths(new Set())
    setPreviewRefs([])
    setFolder(null)
    setResult(null)
    setError(null)
    setGraph(null)
    setGraphNote(null)
    setExpanding(null)
    setTreeNote(null)
    setGitInfo(null)
    dismissPathHint()
    setNotes({})
    setTreeFilter('')
  }

  // 存一条手动备注(第九十八锤):空串 = 删除;上限和淘汰在 shared/notes 里管
  function saveNote(relPath: string, text: string): void {
    if (!folder) return
    setNotes((prev) => {
      const next = upsertNote(prev, relPath, text, Date.now())
      saveNotes(folder, next)
      return next
    })
  }

  // 树上右键「写/编辑备注」(第一百零二锤):先选中节点让概览页签出来,再弹编辑框
  function editNoteFromTree(relPath: string): void {
    if (!result) return
    const f = findFile(result.tree, relPath)
    if (f) {
      followFile(f)
      setNoteEditRequest(relPath)
      return
    }
    const d = findDir(result.tree, relPath)
    if (d) {
      followDir(d)
      setNoteEditRequest(relPath)
    }
  }

  // 树上双击/右键「预览文件」:让「文件预览」页签亮起来装着它(预览被藏了就自动勾回)。
  // 文件还不是当前选中才走跟随链路 —— 双击总伴着单击,别把导航账记重了
  function openPreview(relPath: string): void {
    if (!result) return
    const f = findFile(result.tree, relPath)
    if (!f) return
    if (selectedFile?.relPath !== relPath) followFile(f)
    ensureKindTab('preview', f)
  }

  // 退出预览的老函数已退役(页签地基);树上双击钉住也退役了(小葵的页签模型:
  // 钉不钉只看页签上的双击,树的双击专职开预览)

  // 记一站(第八十三锤)的定义挪去了 scanPath 之前(声明顺序给 lint 让路)

  const [recentUndo, flashRecentUndo, dismissRecentUndo] = useFlashValue<{
    snapshot: RecentProject[]
    removed: RecentProject
  } | null>(null)

  function removeRecent(path: string): void {
    const removed = recents.find((r) => r.p === path)
    if (!removed) return
    setRecents(forgetRecentProject(path))
    flashRecentUndo({ snapshot: recents, removed }, RECENT_UNDO_MS)
  }

  function undoRecentRemove(): void {
    if (!recentUndo) return
    dismissRecentUndo()
    writeRecentProjects(recentUndo.snapshot)
    setRecents(recentUndo.snapshot)
  }

  // 分级扫描:点开还没探的目录,只探这一层,子树和统计接进现有地图
  async function handleExpandLazy(relPath: string): Promise<void> {
    if (!result || expandingRef.current) return
    expandingRef.current = true
    const isCurrent = requests.current.begin('expand')
    const root = result.rootPath
    setExpanding(relPath)
    setTreeNote(null)
    try {
      // 路径契约:renderer 只回传 (rootPath, relPath),绝对路径只能由主进程 joinRoot 解析
      const sub = await window.atlas.scanSubdir(root, relPath)
      if (!isCurrent()) return
      setResult((prev) =>
        prev && prev.rootPath === root
          ? {
              ...prev,
              tree: spliceSubtree(prev.tree, relPath, sub.tree),
              stats: mergeStats(prev.stats, sub.stats)
            }
          : prev
      )
    } catch (err) {
      if (isCurrent()) setTreeNote(cleanErrMsg(err))
    } finally {
      if (isCurrent()) {
        setExpanding(null)
        expandingRef.current = false
      }
    }
  }

  // 四个域钩子的统一接线口:放在最后 —— 它们要吃上面那一摞处理函数当参数,
  // 得等参数们先齐活(声明顺序,老规矩给 lint 让路)。返回值铺开成同名局部量,
  // 上面的函数与下面的 JSX 照旧点名,不用改一个字。
  const {
    uiScale,
    sidebarWidth,
    sidebarCollapsed,
    toggleSidebarCollapsed,
    onSashPointerDown,
    onSashPointerMove,
    endSashDrag,
    onSashDoubleClick,
    onSashKeyDown
  } = useSidebarSash()
  const {
    groups,
    setGroups,
    setActiveGroupId,
    activeGroup,
    activeTabObj,
    visibleOfGroup,
    enabledKinds,
    flashTabId,
    dismissTabFlash,
    paneSplit,
    draggingTab,
    setDraggingTab,
    dropMark,
    setDropMark,
    resetPaneTabs,
    ensureKindTab,
    goAskInChat,
    retargetFollowTabs,
    ensureFollowTabs,
    toggleKind,
    moveTab,
    activateTab,
    pinToggleTab,
    closeTab,
    markFlash,
    applyPaneSplit,
    onPaneSashDown,
    onTabDragEnd,
    onDetachTab,
    showDropHint
  } = usePaneTabs({
    result,
    selectedFile,
    selectedFolder,
    chat,
    freechatHost,
    setRevealPaths
  })
  const { nav, pushNav, goNav } = useNavStack({
    folder,
    result,
    scanning,
    scanPath,
    goHome,
    followFile,
    followDir,
    clearSelection
  })
  const {
    previewRefs,
    setPreviewRefs,
    previewJump,
    fileLinks,
    addPreviewRef,
    removePreviewRef,
    handleDropNode
  } = usePreviewRefs({
    result,
    folder,
    notes,
    chat,
    chatRef,
    openPreview,
    groups,
    activeGroup,
    markFlash,
    editNoteFromTree,
    saveNote
  })

  return (
    <AiSetupContext.Provider value={{ configured: aiConfigured, openSettings: openAiSettings }}>
      <TeachingContext.Provider value={teaching}>
        <div
          className={`app${sidebarCollapsed ? ' is-side-collapsed' : ''}`}
          // 侧栏宽挂 CSS 变量:侧栏本体和顶栏左段(分界线的上行段)同认这一份,
          // 拖 sash 时两边永远对齐;rem 值 = 基准宽 ÷ (16 × uiScale)
          style={
            {
              '--sidebar-w': `${(sidebarWidth / (ROOT_FONT_BASE_PX * uiScale)).toFixed(4)}rem`
            } as React.CSSProperties
          }
        >
          {revived && (
            <div className="revive-note" role="alert">
              画面刚才断了一次,已经自动接上 ——
              正在跑的扫描和后台引擎都没受影响,页面回到了刚打开的样子
            </div>
          )}
          <AppTopBar
            scanning={scanning}
            hasWorkspace={result !== null}
            sidebarShown={!sidebarCollapsed}
            sidebarCollapsed={sidebarCollapsed}
            onToggleSidebar={toggleSidebarCollapsed}
            nav={nav}
            goNav={goNav}
            handleRefresh={handleRefresh}
            filter={treeFilter}
            onFilterChange={setTreeFilter}
            tabs={
              result && !scanning ? (
                <TopBarTabs
                  groups={groups}
                  visibleOfGroup={visibleOfGroup}
                  flashTabId={flashTabId}
                  activateTab={activateTab}
                  closeTab={closeTab}
                  pinToggleTab={pinToggleTab}
                  moveTab={moveTab}
                  setDraggingTab={setDraggingTab}
                  onTabDragEnd={onTabDragEnd}
                  onDetachTab={onDetachTab}
                  enabledKinds={enabledKinds}
                  toggleKind={toggleKind}
                  paneSplit={paneSplit}
                  sidebarCollapsed={sidebarCollapsed}
                />
              ) : null
            }
          />

          {/* 第 2 层:rail | 侧栏 | 内容区,全在顶栏之下。
              侧栏常驻(§7.1 不存在空侧栏):没开工作区时树区 = 「这台电脑」盘符列表 */}
          <div className="app-body">
            <Rail
              hasWorkspace={result !== null && !scanning}
              onOverview={() => ensureKindTab('overview', selectedFile ?? selectedFolder)}
              onChat={() => {
                if (freechatHost === 'pet') window.atlas.openMainPanel()
                ensureKindTab('chat', null)
              }}
              onSettings={() => {
                setSettingsSection('appearance')
                setShowSettings(true)
              }}
              onAiStatus={openAiSettings}
            />
            {!sidebarCollapsed && (
              <WorkspaceSidebar
                result={result}
                notes={notes}
                selectedFile={selectedFile}
                selectedFolder={selectedFolder}
                expanding={expanding}
                revealPaths={revealPaths}
                followFile={followFile}
                followDir={followDir}
                handleExpandLazy={handleExpandLazy}
                editNoteFromTree={editNoteFromTree}
                saveNote={saveNote}
                openPreview={openPreview}
                treeNote={treeNote}
                filter={treeFilter}
                folder={folder}
                scanning={scanning}
                pathDraft={pathDraft}
                pathHint={pathHint}
                pathShaking={pathShaking}
                pathInputRef={pathInputRef}
                setPathDraft={setPathDraft}
                dismissPathHint={dismissPathHint}
                goPath={goPath}
                setPathShaking={setPathShaking}
                goHome={goHome}
                sidebarWidth={sidebarWidth}
                onSashPointerDown={onSashPointerDown}
                onSashPointerMove={onSashPointerMove}
                endSashDrag={endSashDrag}
                onSashDoubleClick={onSashDoubleClick}
                onSashKeyDown={onSashKeyDown}
                drives={drives}
                drivesNote={drivesNote}
                onOpenDrive={(path) => void scanPath(path)}
              />
            )}
            {result && !scanning ? (
              // 资源管理器式双栏:左边目录树,右边当前选中项;两边各自独立滚动
              <main className="workspace">
                <section className="detail">
                  {scanToast && (
                    <div className="scan-toast" role="status">
                      {scanToast}
                    </div>
                  )}
                  <PaneGroups
                    groups={groups}
                    freechatHost={freechatHost}
                    moveTab={moveTab}
                    setActiveGroupId={setActiveGroupId}
                    dropMark={dropMark}
                    setDropMark={setDropMark}
                    draggingTab={draggingTab}
                    onPaneSashDown={onPaneSashDown}
                    applyPaneSplit={applyPaneSplit}
                    paneSplit={paneSplit}
                    showDropHint={showDropHint}
                    result={result}
                    previewRefs={previewRefs}
                    removePreviewRef={removePreviewRef}
                    handleDropNode={handleDropNode}
                    fileLinks={fileLinks}
                    chatSuggestionsOn={chatSuggestionsOn}
                    renderTabBody={(t) => (
                      <TabBody
                        tab={t}
                        result={result}
                        notes={notes}
                        noteEditRequest={noteEditRequest}
                        previewRefs={previewRefs}
                        previewJump={previewJump}
                        selectedFile={selectedFile}
                        selectedFolder={selectedFolder}
                        structure={structure}
                        analyzing={analyzing}
                        analyzeNote={analyzeNote}
                        graph={graph}
                        graphLoading={graphLoading}
                        graphNote={graphNote}
                        gitInfo={gitInfo}
                        setGitInfo={setGitInfo}
                        gitLoading={gitLoading}
                        chatSuggestionsOn={chatSuggestionsOn}
                        chat={chat}
                        chatContext={chatContext}
                        fileLinks={fileLinks}
                        goAskInChat={goAskInChat}
                        handleLoadGraph={handleLoadGraph}
                        jumpTo={jumpTo}
                        saveNote={saveNote}
                        editNoteFromTree={editNoteFromTree}
                        openPreview={openPreview}
                        closeTab={closeTab}
                        addPreviewRef={addPreviewRef}
                        removePreviewRef={removePreviewRef}
                        handleDropNode={handleDropNode}
                      />
                    )}
                  />
                </section>
              </main>
            ) : (
              <main className="content">
                {scanning && (
                  <div className="state" role="status" aria-live="polite">
                    <h1>正在整理项目地图…</h1>
                    <ProgressDots />
                    <p>只读取文件,不会修改代码。文件较多时可以返回首页,换一个更小的文件夹。</p>
                    <button type="button" className="btn" onClick={goHome}>
                      返回首页
                    </button>
                  </div>
                )}
                {!scanning && error && (
                  <div className="state" role="alert">
                    <h1>这个文件夹没能打开</h1>
                    <Notice kind="error">{error}</Notice>
                    <p>可以重试,或重新选择项目文件夹。</p>
                    <div className="state-actions">
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => {
                          if (folder) void scanPath(folder)
                          else void handlePick()
                        }}
                      >
                        重试
                      </button>
                      <button type="button" className="btn" onClick={() => void handlePick()}>
                        选择项目文件夹
                      </button>
                      <button type="button" className="btn btn-ghost" onClick={goHome}>
                        返回首页
                      </button>
                    </div>
                  </div>
                )}
                {!folder && !scanning && !error && (
                  <HomePage
                    recents={recents}
                    drives={drives}
                    drivesNote={drivesNote}
                    recentUndo={recentUndo}
                    onPick={() => void handlePick()}
                    onOpen={(path) => void scanPath(path)}
                    onRemoveRecent={removeRecent}
                    onUndoRecent={undoRecentRemove}
                  />
                )}
              </main>
            )}
          </div>

          {/* 模型状态栏(第七十锤):钉在窗口最底下,首页/项目页都常驻,模型热身到哪了随时看得见。
              UI v3 里它要退役进 rail 底的 AI 状态钮(B4),本块先留岗 */}
          <ModelStatusBar />

          {/* 文件路径右键菜单(全局单例):绿字文件链接上右键弹「复制完整路径」,只复制不打开 */}
          <FilePathMenu />

          {showSettings && (
            <SettingsDialog
              workspaceName={folder ? (folder.split(/[\\/]/).pop() ?? null) : null}
              initialSection={settingsSection}
              onAiConfigSaved={(c) => {
                setAiConfigured(isAiConfigured(c))
                setTeaching(sanitizePersonalization(c.personalization).teaching)
              }}
              chatSuggestionsOn={chatSuggestionsOn}
              onChatSuggestionsChange={(v) => {
                setChatSuggestionsOn(v)
                saveChatSuggestionsOn(v)
              }}
              onClose={() => setShowSettings(false)}
            />
          )}
        </div>
      </TeachingContext.Provider>
    </AiSetupContext.Provider>
  )
}

export default App
