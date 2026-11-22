# Phrase Pocket (随手收)

Save English expressions, recommendations and quick memos while watching TikTok, Bilibili or Douyin on the web. The Chrome / Edge extension works on its own; with the optional Windows companion, saved cards also rotate on your desktop.

| Extension only | With the Windows companion |
| --- | --- |
| Capture words and memos next to the video | Persistent desktop cards with a configurable rotation interval |
| Subtitle pre-fill when captions are readable; manual input always works | Show words only, memos only, or both |
| Favourites, editing, offline lookup of common expressions | 60k offline English–Chinese entries bundled; full ECDICT import supported |
| Flashcard review of saved words (browser mode) | Review state (known / again) is kept in sync with the collection |

## Install the browser extension

1. Unzip **PhrasePocket-Extension**, or clone this repository and use the **extension** folder.
2. Open `chrome://extensions` or `edge://extensions`, enable **Developer mode** and choose **Load unpacked**. Select the folder that directly contains `manifest.json`.
3. Open or refresh a supported video site, click "随手收" in the bottom-right corner, then choose "记单词" (word) or "记备忘" (memo). Press Enter to save. **Alt+Shift+S** opens the capture box as well.

When upgrading, back up first via "备份与导出" on the library page, then replace the extension folder and click **Reload**. Existing words and memos migrate automatically by type.

## Capturing on video pages

Select any copyable English text on the page and press the shortcut to pre-fill the capture box. "取当前字幕" tries to read the player's current English caption; edit before saving.

| Site | Capture & captions |
| --- | --- |
| TikTok web | Manual input, text selection, and reading the player's English captions when available |
| Bilibili web | Manual input, text selection, and English CC captions (enable CC in the player first) |
| Douyin web | Manual input and text selection; caption pre-fill when a readable English track exists |

Words and memos are stored in separate collections, each with search. "备份与导出" backs up one or both collections; merge-import deduplicates by type and content. The word collection exports to **Anki-compatible TSV** and supports local system TTS.

## Flashcard review

On the word collection page, click **复习单词** to start a flashcard session: the meaning is hidden until you reveal it, then mark the card **认识** (known) or **不认识** (again). Review results are stored per entry (`review` / `reviewedAt`). Review mode is available while the collection is stored in the browser.

## Optional: Windows desktop cards

1. Fully unzip **PhrasePocket-Windows** to a permanent folder and double-click **Install.cmd**. Windows 10/11, no administrator rights required. To upgrade, quit the old desktop component from the tray menu first, then run the new **Install.cmd**.
2. On the library page, click **连接 Windows 卡片**. Existing browser collections are copied to the desktop, and new entries are saved there. Switching back to browser mode copies both collections back.
3. Use "⋯" on the desktop card to switch content type, rotation interval and definitions. Default: a new card every 5 minutes. Drag the title to move it; click × to collapse and double-click the tray icon to reopen.

The extension alone includes a small built-in word list. The Windows package bundles 60k entries selected from ECDICT for offline lookup; entries without a definition can be enriched via "查释义". For the full dictionary, download `ecdict-sqlite-28.zip` from the [ECDICT releases page](https://github.com/skywind3000/ECDICT/releases/tag/1.0.28) and import it via "⋯ → 导入 ECDICT 词典". Bundled data uses the [ECDICT MIT license](https://github.com/skywind3000/ECDICT/blob/master/LICENSE).

If [Ollama](https://docs.ollama.com/) with a local model is installed, set the model name under "⋯ → 设置本机模型" to generate definitions for expressions missing from the dictionary. Leave empty to disable.

## Where data lives

Browser mode: the current browser profile. Desktop mode: `%LOCALAPPDATA%\PhrasePocket`. The app does not record browsing history, video links or playback positions. A caption read on demand is used only for that lookup and is never stored; memos are never sent for translation. Removing the extension clears its browser data. **Uninstall.cmd** only removes this copy's browser connection and keeps desktop collections.

## Build from source

- Extension: load **extension/** directly. With Node.js 22.13+, run `node scripts/browser-smoke.mjs`.
- Windows companion: run **scripts/build.ps1** with Node.js 22.13+. The first build downloads pinned ECDICT source data and produces `build/PhrasePocket.exe` and `build/ecdict-bundled.db`. No separate .NET SDK required.
- Package extension + Windows + sources: **scripts/package.ps1**. Run `node scripts/smoke.mjs --ui` to verify native messaging, dictionary import and desktop window initialisation.

## Android companion

A native Android app (share-to-save, floating capture ball, SM-2 review, offline ECDICT, Anki export, optional AI definitions via your own OpenAI-compatible endpoint) is developed in the companion project [phrase-pocket-android](https://github.com/emptyqing-bit/phrase-pocket-android). JSON backups are interchangeable between Android and the extension (merge-import deduplicates by type and content).