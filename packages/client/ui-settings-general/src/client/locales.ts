/** Shell chrome, General-nav, and About-section dictionaries; feature rows own their copy. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'trigger': '设置',
  'title': '设置',
  'close': '关闭',
  'openDocument': '打开配置文件',
  'openDocument.error': '无法打开配置文件',
  'general.nav': '通用设置',
  'about.nav': '关于',
  'about.companyName': 'PineSound',
  'about.companyTagline': 'AI 音频创作平台',
  'about.companyIntro': 'PineSound 是一家 AI 音频创作平台，提供 AI 音效、配乐生成、配音、音色克隆与设计，以及云端音频素材搜索与识别，服务广大的音频与视频创作者。',
  'about.product': 'DeepSeek Harness Desktop（由 PineSound 基于 deepseek-harness 构建）',
  'about.currentVersion': '当前版本',
  'about.checkUpdates': '检查更新',
  'about.checking': '正在检查更新…',
  'about.upToDate': '已是最新版本',
  'about.updateAvailable': '发现新版本',
  'about.download': '去下载',
  'about.updateCheckFailed': '检查更新失败',
} satisfies Record<string, string>

/** The settings namespace key union. */
export type SettingsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'trigger': 'Settings',
  'title': 'Settings',
  'close': 'Close',
  'openDocument': 'Open configuration file',
  'openDocument.error': 'Could not open configuration file',
  'general.nav': 'General',
  'about.nav': 'About',
  'about.companyName': 'PineSound',
  'about.companyTagline': 'AI audio creation platform',
  'about.companyIntro': 'PineSound is an AI audio creation platform offering AI sound-effect and score generation, voiceover, voice cloning and design, plus cloud audio asset search and recognition, serving audio and video creators.',
  'about.product': 'DeepSeek Harness Desktop (built by PineSound on the deepseek-harness project)',
  'about.currentVersion': 'Current version',
  'about.checkUpdates': 'Check for updates',
  'about.checking': 'Checking for updates…',
  'about.upToDate': 'You are on the latest version',
  'about.updateAvailable': 'A new version is available',
  'about.download': 'Download',
  'about.updateCheckFailed': 'Could not check for updates',
} satisfies Record<SettingsKey, string>
