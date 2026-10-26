import {parseHls, formatBytes} from "./core.js";

export async function readPlaylist(url) {
  const response = await fetch(url, {credentials: "include", signal: AbortSignal.timeout(10000)});
  if (!response.ok) throw new Error(`清单请求失败（HTTP ${response.status}），请重新播放视频后重试。`);
  const reader = response.body.getReader(), parts = []; let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 2 * 1024 ** 2) throw new Error("清单过大，暂时无法解析。");
      parts.push(value);
    }
  } catch(e) { await reader.cancel().catch(() => {}); throw e; }
  return parseHls(await new Blob(parts).text(), response.url || url);
}

export async function inspectHls(item) {
  const media = await readPlaylist(item.url);
  if (media.variants.length) return media.variants;
  return [{url: item.url, resolution: item.height ? `${item.height}p` : "原始清晰度", bandwidth: 0, media}];
}

async function contentLength(url) {
  try {
    const response = await fetch(url, {method: "HEAD", credentials: "include", signal: AbortSignal.timeout(5000)});
    const value = Number(response.headers.get("content-length"));
    if (response.ok && !response.headers.get("content-encoding") && Number.isSafeInteger(value) && value > 0) return value;
  } catch {}
  return null;
}

export async function inspectQuality(choice) {
  if (choice.audio) throw new Error("独立音轨暂不支持下载。");
  const media = choice.media || await readPlaylist(choice.url);
  if (media.variants.length) throw new Error("暂不支持多层主清单。");
  if (!media.ended) throw new Error("直播或尚未结束的播放列表暂不支持下载。");
  if (!media.segments.length) throw new Error("清单没有可下载的分片。");
  if (media.segments.length > 6000) throw new Error("分片超过 6,000 个，暂不支持下载。");
  const rate = choice.averageBandwidth || choice.bandwidth;
  let size = rate > 0 && media.duration > 0 ? rate * media.duration / 8 : null;
  let estimated = true;
  if (!size) {
    // Probe at most three distributed segments. Never download video data just
    // to populate the popup, and don't mistake manifest length for video size.
    const indices = [...new Set([0, Math.floor(media.segments.length / 2), media.segments.length - 1])];
    const sizes = await Promise.all(indices.map(index => contentLength(media.segments[index])));
    const initSize = media.init ? await contentLength(media.init) : 0;
    if (sizes.every(value => value !== null)) {
      const bytes = sizes.reduce((sum, value) => sum + value, 0);
      const duration = indices.reduce((sum, index) => sum + media.segmentDurations[index], 0);
      if (indices.length === media.segments.length && initSize !== null) { size = bytes + initSize; estimated = false; }
      else if (duration > 0 && media.duration > 0) size = bytes / duration * media.duration + (initSize || 0);
    }
  }
  return {size: size ? Math.round(size) : null, estimated, duration: media.duration, extension: media.init ? "mp4" : "ts"};
}

export function sizeLabel(info) {
  return info?.size ? `${info.estimated ? "约 " : ""}${formatBytes(info.size)}${info.estimated ? "（估算）" : ""}` : "大小未知";
}
