export const DEFAULT_SETTINGS = { enabled: true, minSizeMB: 0, folder: "StreamPocket", saveAs: true, blockedHosts: "" };

export function httpUrl(value, base) {
  try { const url = new URL(value, base); return /^(https?:)$/.test(url.protocol) ? url.href : null; } catch { return null; }
}

export function mediaType(url, mime = "") {
  if (!httpUrl(url)) return null;
  const path = new URL(url).pathname.toLowerCase();
  mime = mime.split(";")[0].trim().toLowerCase();
  if (path.endsWith(".m3u8") || /(?:mpegurl)/.test(mime)) return "hls";
  if (path.endsWith(".mpd") || mime === "application/dash+xml") return "dash";
  // Transport segments are deliberately omitted from the media list.
  if (/\.(?:m4s|ts|aac|vtt)$/.test(path) || /(?:mp2t)/.test(mime)) return null;
  if (/\.(?:mp4|webm|mov|m4v|ogv|mkv)$/.test(path) || mime.startsWith("video/")) return "video";
  if (/\.(?:mp3|m4a|ogg|wav|flac|opus)$/.test(path) || mime.startsWith("audio/")) return "audio";
  return null;
}

export function safeName(value, fallback = "video") {
  const name = String(value || "").replace(/[\x00-\x1f<>:"/\\|?*]/g, "_").replace(/\.{2,}/g, "_").replace(/^[.\s]+|[.\s]+$/g, "").slice(0, 120);
  return !name ? fallback : /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? `_${name}` : name;
}

export function filename(item, folder = "", forcedExt) {
  const path = new URL(item.url).pathname;
  const ext = forcedExt || (item.type === "hls" ? "m3u8" : item.type === "dash" ? "mpd" : path.match(/\.([a-z0-9]{2,5})$/i)?.[1] || (item.type === "audio" ? "m4a" : "mp4"));
  const title = safeName(item.title || decodeURIComponentSafe(path.split("/").pop()));
  const stem = title.replace(/\.(mp4|webm|mov|m4v|ogv|mkv|mp3|m4a|ogg|wav|flac|opus|m3u8|mpd|ts)$/i, "");
  return `${folder ? safeName(folder) + "/" : ""}${stem || "video"}.${ext}`;
}
function decodeURIComponentSafe(value) { try { return decodeURIComponent(value); } catch { return value; } }

export function nameStem(value) {
  return String(value || "").replace(/\.(mp4|webm|mov|m4v|ogv|mkv|mp3|m4a|ogg|wav|flac|opus|m3u8|mpd|ts)$/i, "");
}

export function originalName(url, disposition = "") {
  const encoded = disposition.match(/filename\*\s*=\s*(?:"?)(?:UTF-8|utf-8)'[^']*'([^;"\r\n]+)/)?.[1];
  const plain = disposition.match(/(?:^|;)\s*filename\s*=\s*(?:"([^"\r\n]*)"|([^;\r\n]*))/i);
  if (encoded || plain) return safeName(encoded ? decodeURIComponentSafe(encoded.trim()) : (plain[1] ?? plain[2]).trim());
  try {
    const parsed = new URL(url);
    for (const key of ["filename", "file", "name"]) {
      const candidate = parsed.searchParams.get(key);
      if (candidate && /\.(mp4|webm|mov|m4v|mkv|mp3|m4a|m3u8|mpd)$/i.test(candidate)) return safeName(candidate);
    }
    const candidate = decodeURIComponentSafe(parsed.pathname.split("/").pop());
    return /\.(mp4|webm|mov|m4v|ogv|mkv|mp3|m4a|ogg|wav|flac|opus|m3u8|mpd)$/i.test(candidate) ? safeName(candidate) : null;
  } catch {return null;}
}

export function suggestedName(item, pageMetadata, pageTitle) {
  const meaningful = value => {
    const stem = nameStem(value).trim();
    return stem && !/^(?:index|master|playlist|manifest|stream|video|audio|play|chunklist|main|\d{3,4}p?|[a-f0-9]{16,})(?:[-_.]\d+)?$/i.test(stem);
  };
  const choices = [
    {title: item.headerName, priority: 100},
    {title: item.videoTitle, priority: item.videoTitlePriority || 20},
    {title: pageMetadata?.title, priority: pageMetadata?.priority || 20},
    {title: pageTitle, priority: 10},
    {title: originalName(item.url), priority: ["hls", "dash"].includes(item.type) ? 5 : 80}
  ].filter(choice => typeof choice.title === "string" && meaningful(choice.title)).sort((a,b) => b.priority - a.priority);
  return {title: choices[0]?.title.trim() || "视频", nameVersion: 1};
}

export function formatBytes(size) {
  if (!size) return "大小未知";
  const i = Math.min(3, Math.floor(Math.log(size) / Math.log(1024)));
  return `${(size / 1024 ** i).toFixed(i ? 1 : 0)} ${["B", "KB", "MB", "GB"][i]}`;
}

export function isBlocked(url, settings) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return settings.blockedHosts.split(/[\n,]+/).map(s => s.trim().toLowerCase()).filter(Boolean).some(s => host === s || host.endsWith(`.${s}`));
  } catch { return true; }
}

export function attributes(line) {
  const result = {};
  for (const match of line.matchAll(/([A-Z0-9-]+)=(?:"([^"]*)"|([^,]*))/g)) result[match[1]] = match[2] ?? match[3];
  return result;
}

export function parseHls(text, base) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (lines[0] !== "#EXTM3U") throw new Error("服务器未返回有效的 HLS 清单，链接可能已过期。");
  const variants = [], segments = [], segmentDurations = [];
  let pending, duration = 0, segmentDuration = 0, init = null;
  for (const line of lines) {
    if (line.startsWith("#EXT-X-KEY:") || line.startsWith("#EXT-X-SESSION-KEY:")) {
      if (attributes(line).METHOD !== "NONE") throw new Error("此视频已加密，当前版本不支持解密或 DRM 下载。");
    }
    if (line.startsWith("#EXT-X-BYTERANGE:") || /#EXT-X-MAP:.*BYTERANGE=/.test(line)) throw new Error("暂不支持字节范围 HLS。");
    if (line.startsWith("#EXT-X-STREAM-INF:")) pending = attributes(line);
    else if (line.startsWith("#EXTINF:")) { segmentDuration = Number.parseFloat(line.slice(8)) || 0; duration += segmentDuration; }
    else if (line.startsWith("#EXT-X-MAP:")) {
      const next = httpUrl(attributes(line).URI, base);
      if (!next) throw new Error("初始化分片地址无效。");
      if (init && next !== init) throw new Error("暂不支持包含多个初始化分片的 HLS。");
      init = next;
    } else if (line === "#EXT-X-DISCONTINUITY") throw new Error("暂不支持含时间线跳变的 HLS，请导出清单使用其他工具处理。");
    else if (!line.startsWith("#")) {
      const url = httpUrl(line, base);
      if (!url) throw new Error("清单包含不支持的分片地址。");
      if (pending) { variants.push({url, bandwidth: Number(pending.BANDWIDTH) || 0, averageBandwidth: Number(pending["AVERAGE-BANDWIDTH"]) || 0, resolution: pending.RESOLUTION || "", audio: pending.AUDIO || "", codecs: pending.CODECS || ""}); pending = null; }
      else { segments.push(url); segmentDurations.push(segmentDuration); segmentDuration = 0; }
    }
  }
  return { variants: variants.sort((a,b) => b.bandwidth-a.bandwidth), segments, segmentDurations, init, duration, ended: lines.includes("#EXT-X-ENDLIST") };
}
