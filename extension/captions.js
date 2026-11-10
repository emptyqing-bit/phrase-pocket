(() => {
  const clean = text => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 360);
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
  function currentVideo() {
    return Array.from(document.querySelectorAll('video'))
      .map(v => ({v, area:visible(v)})).filter(x => x.area > 600 && x.v.readyState >= 2)
      .sort((a,b) => (b.area * (b.v.paused ? 1 : 1.12)) - (a.area * (a.v.paused ? 1 : 1.12)))[0]?.v;
  }
  function readTrack(video) {
    for (const track of Array.from(video.textTracks || [])) {
      if (!['subtitles','captions'].includes(track.kind) || track.mode === 'disabled') continue;
      if (track.language && !/^en(?:-|$)/i.test(track.language)) continue;
      const text = clean(Array.from(track.activeCues || []).map(textOnly).join(' '));
      if (text) return text;
    }
    return '';
  }
  function readOverlay(video) {
    // Only explicit captions, inside the current player. Never read a post's description.
    const selectors = '[class*="DivAutoCaption"],[class*="DivClosedCaption"],[data-e2e="video-subtitle"],[data-e2e="video-closed-caption"]';
    const rect = video.getBoundingClientRect();
    let parent = video.parentElement;
    for (let depth = 0; parent && depth < 7; parent = parent.parentElement, depth++) {
      if (parent.querySelectorAll('video').length !== 1) break;
      for (const node of parent.querySelectorAll(selectors)) {
        if (!visible(node)) continue;
        const box = node.getBoundingClientRect();
        const x = (box.left + box.right) / 2;
        const y = (box.top + box.bottom) / 2;
        if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
        const text = clean(node.innerText);
        if (/[a-z]/i.test(text) && !/[\u3400-\u9fff]/.test(text)) return text;
      }
    }
    return '';
  }
  globalThis.phrasePocketCaptions = {
    read() {
      const video = currentVideo();
      return video ? readTrack(video) || readOverlay(video) : '';
    }
  };
})();
