(() => {
  const hosts = new Map([
    ['www.tiktok.com', 'tiktok'], ['tiktok.com', 'tiktok'],
    ['www.bilibili.com', 'bilibili'], ['bilibili.com', 'bilibili'],
    ['www.douyin.com', 'douyin'], ['douyin.com', 'douyin']
  ]);

  globalThis.phrasePocketSite = url => {
    if (!url) return '';
    try {
      const page = new URL(url);
      return page.protocol === 'https:' && !page.port ? hosts.get(page.hostname) || '' : '';
    } catch {
      return '';
    }
  };
})();
