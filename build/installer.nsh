; CodeAtlas NSIS 补丁脚本(右键问一问 2026-09-18 立;功能下线 2026-09-20 改成纯清场)
; 资源管理器右键菜单已下线,这份脚本只剩一件事:清旧版写过的注册表键。
; 装的时候清一遍(升级的用户不留僵尸菜单项),卸的时候也清一遍,都只动 HKCU。

!macro customInstall
  DeleteRegKey HKCU "Software\Classes\*\shell\CodeAtlasAsk"
  DeleteRegKey HKCU "Software\Classes\Directory\shell\CodeAtlasOpen"
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\*\shell\CodeAtlasAsk"
  DeleteRegKey HKCU "Software\Classes\Directory\shell\CodeAtlasOpen"
!macroend
