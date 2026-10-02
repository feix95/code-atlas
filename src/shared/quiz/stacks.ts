// 常用技术栈预设清单(§3.7):立项单「技术选型回填」与导出目标默认值的选项来源。
// 纯配置表,按平台分组;agent 给的结论不在表里时允许粘贴自由文本。

export interface StackGroup {
  platform: string
  stacks: string[]
}

export const TECH_STACK_PRESETS: StackGroup[] = [
  {
    platform: '电脑桌面',
    stacks: [
      'Electron + React',
      'Tauri + React',
      'Tauri + Vue',
      'Tauri + Svelte',
      'Flutter Desktop',
      '.NET(WinUI、MAUI)'
    ]
  },
  {
    platform: '手机',
    stacks: [
      'React Native(Expo)',
      'Flutter',
      'SwiftUI(仅 iOS)',
      'Jetpack Compose(仅 Android)',
      'Capacitor(网页套壳)',
      'uni-app(含小程序)',
      'Taro(含小程序)'
    ]
  },
  {
    platform: '网页',
    stacks: ['React(Next.js、Vite)', 'Vue(Nuxt、Vite)', 'Svelte(SvelteKit)', 'Astro']
  },
  {
    platform: '样式方案(网页类)',
    stacks: ['原生 CSS 变量', 'Tailwind CSS', 'UnoCSS', 'CSS-in-JS']
  }
]
