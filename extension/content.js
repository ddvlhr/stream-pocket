(() => {
  const seen = new Map();
  let lastMetadata = "";
  let scheduled;
  function pageMetadata() {
    // Prefer structured video metadata over generic player/CDN document titles.
    const findVideo = (value, depth = 0) => {
      if (!value || typeof value !== "object" || depth > 8) return null;
      if ([].concat(value["@type"] || []).includes("VideoObject") && typeof value.name === "string" && value.name.trim()) return value.name.trim();
      for (const child of Object.values(value)) { const found = findVideo(child, depth + 1); if (found) return found; }
      return null;
    };
    for (const node of document.querySelectorAll('script[type="application/ld+json"]')) {
      if (node.textContent.length > 100000) continue;
      try {const title = findVideo(JSON.parse(node.textContent)); if (title) return {title, priority: 55};} catch {}
    }
    for (const [selector, priority] of [['meta[property="og:title"]',50],['meta[name="twitter:title"]',45]]) {
      const title = document.querySelector(selector)?.content?.trim(); if (title) return {title, priority};
    }
    const heading = document.querySelector("h1")?.textContent?.trim();
    return heading ? {title: heading, priority: 40} : {title: document.title, priority: 20};
  }
  function scan() {
    const items = [];
    const metadata = pageMetadata();
    const signature = JSON.stringify(metadata);
    if (window.top === window && signature !== lastMetadata) {
      lastMetadata = signature;
      chrome.runtime.sendMessage({type: "PAGE_METADATA", ...metadata}).catch(() => {});
    }
    const add = (url, details = {}) => {
      if (!/^https?:/i.test(url || "")) return;
      const signature = `${details.width || 0}:${details.height || 0}:${details.title || ""}:${details.titlePriority || 0}`;
      if (seen.get(url) === signature) return;
      seen.set(url, signature);
      if (seen.size > 1000) seen.delete(seen.keys().next().value);
      items.push({url, title: metadata.title, titlePriority: window.top === window ? metadata.priority : 15, ...details});
    };
    document.querySelectorAll("video,audio").forEach(media => {
      const mediaTitle = media.getAttribute("title") || media.getAttribute("aria-label");
      const details = {width: media.videoWidth, height: media.videoHeight, ...(mediaTitle ? {title: mediaTitle, titlePriority: 60} : {}), mime: media.tagName === "VIDEO" ? "video/mp4" : "audio/mp4"};
      add(media.currentSrc || media.src, details);
      media.querySelectorAll("source").forEach(source => add(source.src, {...details, mime: source.type || details.mime}));
    });
    document.querySelectorAll("a[href]").forEach(a => { if (/\.(mp4|webm|m3u8|mpd|mov|m4a|mp3)(?:[?#]|$)/i.test(a.href)) add(a.href); });
    performance.getEntriesByType("resource").forEach(entry => { if (/\.(mp4|webm|m3u8|mpd|mov|m4a|mp3)(?:[?#]|$)/i.test(entry.name)) add(entry.name); });
    if (items.length) chrome.runtime.sendMessage({type: "FOUND", items}).catch(() => {});
  }
  function schedule() { clearTimeout(scheduled); scheduled = setTimeout(scan, 400); }
  new MutationObserver(schedule).observe(document.documentElement, {childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["src", "href", "content", "title", "aria-label"]});
  document.addEventListener("loadedmetadata", schedule, true);
  chrome.runtime.onMessage.addListener(message => { if (message.type === "SCAN") { seen.clear(); lastMetadata = ""; scan(); } });
  try { new PerformanceObserver(schedule).observe({type: "resource", buffered: true}); } catch {}
  scan();
})();
