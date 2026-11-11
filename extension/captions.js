(() => {
  const clean = text => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 360);
  const tiktokCaptions = '[class*="DivAutoCaption"],[class*="DivClosedCaption"],[data-e2e="video-subtitle"],[data-e2e="video-closed-caption"]';
  const bilibiliPlayer = '.bpx-player-container,.bilibili-player-area';
  const bilibiliCaptions = '.bpx-player-subtitle-panel-text,.bpx-player-subtitle-wrap .bpx-player-subtitle-item,.bilibili-player-video-subtitle .subtitle-item';
  const englishLines = text => String(text ?? '').split(/\r?\n/)
    .filter(line => /[a-z]/i.test(line) && !/[\u3400-\u9fff]/.test(line));
  const textOnly = cue => {
    if (typeof cue?.getCueAsHTML === 'function') return cue.getCueAsHTML().textContent;
    return typeof cue?.text === 'string' ? cue.text.replace(/<[^>]+>/g, '') : '';
  };
  function visible(element) {
    const style = getComputedStyle(element);
    if (style.visibility !== 'visible' || style.display === 'none' || style.opacity === '0') return 0;
    const rect = element.getBoundingClientRect();
    const width = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(0, rect.left));
    const height = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(0, rect.top));
    return width * height;
  }
  function currentVideo(root) {
    return Array.from(root.querySelectorAll('video'))
      .map(v => ({v, area:visible(v)})).filter(x => x.area > 600 && x.v.readyState >= 2)
      .sort((a,b) => (b.area * (b.v.paused ? 1 : 1.12)) - (a.area * (a.v.paused ? 1 : 1.12)))[0]?.v;
  }
  function readTrack(video) {
    for (const track of Array.from(video.textTracks || [])) {
      if (!['subtitles','captions'].includes(track.kind) || track.mode === 'disabled') continue;
      if (track.language && !/^en(?:-|$)/i.test(track.language)) continue;
      const text = clean(Array.from(track.activeCues || []).flatMap(cue => englishLines(textOnly(cue))).join(' '));
      if (text) return text;
    }
    return '';
  }
  function overlayText(player, selectors, rect) {
    const lines = new Set();
    for (const node of player.querySelectorAll(selectors)) {
      if (!visible(node)) continue;
      const box = node.getBoundingClientRect();
      const x = (box.left + box.right) / 2;
      const y = (box.top + box.bottom) / 2;
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
      for (const line of englishLines(node.innerText)) lines.add(clean(line));
    }
    return clean([...lines].join(' '));
  }
  function readTikTokOverlay(video) {
    const rect = video.getBoundingClientRect();
    let parent = video.parentElement;
    for (let depth = 0; parent && depth < 7; parent = parent.parentElement, depth++) {
      if (parent.querySelectorAll('video').length !== 1) break;
      const text = overlayText(parent, tiktokCaptions, rect);
      if (text) return text;
    }
    return '';
  }
  function readBilibili() {
    const player = Array.from(document.querySelectorAll(bilibiliPlayer))
      .map(element => ({element, area:visible(element)}))
      .filter(({area}) => area > 600).sort((a,b) => b.area - a.area)[0]?.element;
    const video = currentVideo(player || document);
    const track = video ? readTrack(video) : '';
    return track || (player ? overlayText(player, bilibiliCaptions, player.getBoundingClientRect()) : '');
  }
  globalThis.phrasePocketCaptions = {
    read() {
      const site = globalThis.phrasePocketSite(location.href);
      if (site === 'bilibili') return readBilibili();
      if (site !== 'tiktok' && site !== 'douyin') return '';
      const video = currentVideo(document);
      if (!video) return '';
      return readTrack(video) || (site === 'tiktok' ? readTikTokOverlay(video) : '');
    }
  };
})();
