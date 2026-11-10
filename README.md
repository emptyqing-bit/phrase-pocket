# 随手收 · Phrase Pocket

刷 TikTok 时记下想学的英文表达、种草信息或随手备忘。Chrome / Edge 扩展可以独立使用；连接可选的 Windows 组件后，桌面角落也能轮换显示收藏。

| 只装浏览器扩展 | 加装 Windows 组件 |
| --- | --- |
| 视频旁记录单词和备忘 | 桌面常驻卡片，可调轮换间隔 |
| 字幕可读时预填，也能直接输入 | 可选只显示单词、只显示备忘或两种都显示 |
| 收藏、编辑、离线查常用表达 | 可导入完整 ECDICT，或接入本机 Ollama |

## 安装浏览器扩展

1. 解压 **PhrasePocket-Extension**，或下载源码后使用其中的 **extension** 文件夹。
2. 打开 **chrome://extensions** 或 **edge://extensions**，开启「开发者模式」并选择「加载已解压的扩展程序」。选中直接包含 **manifest.json** 的文件夹。
3. 打开或刷新 TikTok 网页，点右下角「随手收」，选择「记单词」或「记备忘」。输入后按回车保存。也可以按 **Alt+Shift+S** 打开记录框。

点击扩展图标进入「我的收藏」，可以修改词、释义和备忘。遇到读不到的字幕，直接输入即可。字幕预填依赖 TikTok 网页提供可读取的文字，画面里的字幕不一定能取到。

## 可选：连接 Windows 桌面卡片

1. 完整解压 **PhrasePocket-Windows** 到准备长期保留的文件夹，双击 **Install.cmd**。支持 Windows 10/11，无需管理员权限。
2. 在扩展的「我的收藏」点击「连接 Windows 卡片」。已有浏览器收藏会复制到桌面收藏，之后新记录直接保存到桌面收藏。切回浏览器模式时会将当前桌面收藏复制回来。
3. 在桌面卡片右上角「⋯」切换显示类型、轮换频率和释义设置。默认每 5 分钟换一条。拖动标题可挪位置，点 × 收起后双击系统托盘图标可展开。

内置词表能查 **awkward**、**count me in**、**I’m down** 等常用表达。想查更多，可从 [ECDICT 发布页](https://github.com/skywind3000/ECDICT/releases/tag/1.0.28)下载 **ecdict-sqlite-28.zip**，解压后在桌面「⋯ → 导入 ECDICT 词典」选择数据库。已有的无释义词可在收藏页点「查释义」。

如果已安装 [Ollama](https://docs.ollama.com/) 并下载了本地模型，可在「⋯ → 设置本机模型」填写模型名。遇到词典未收录的表达，先保存再补释义。留空即关闭。

## 收藏存在哪里

浏览器模式保存在当前浏览器配置；桌面模式保存在 **%LOCALAPPDATA%\PhrasePocket**。应用不记录浏览历史、视频链接或播放时间点。主动取到的一句字幕只用于当次查释义，不入库；备忘不送去翻译。

浏览器模式下，移除扩展会清除该浏览器的扩展数据。移动桌面安装目录后要重新运行 **Install.cmd**。**Uninstall.cmd** 只移除本副本的浏览器连接，保留桌面收藏。

## 从源码构建

- 浏览器扩展：直接加载 **extension/**。使用 Node.js 22.13+ 运行 **node scripts/browser-smoke.mjs**。
- Windows 组件：运行 **scripts/build.ps1**，产物在 **build/PhrasePocket.exe**，不需要另装 .NET SDK。
- 一次打包插件、Windows 版和源码：运行 **scripts/package.ps1**。运行 **node scripts/smoke.mjs --ui** 验证本机通信、词典导入和桌面窗口初始化。
