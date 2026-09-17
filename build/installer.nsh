; CodeAtlas NSIS 补丁脚本(右键问一问,2026-09-18)
; electron-builder 的 nsis.include 挂这份:卸载时把右键菜单两个注册表键删干净。
; 应用侧(设置页开关)写的是 HKCU 用户级键,不需要管理员权限;卸载同样只动 HKCU。
; 键名和 src/main/shellMenu.ts 里的 SHELL_ASK_KEY / SHELL_OPEN_KEY 一口约定,改一处必改两处。

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\*\shell\CodeAtlasAsk"
  DeleteRegKey HKCU "Software\Classes\Directory\shell\CodeAtlasOpen"
!macroend
