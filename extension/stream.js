import {parseHls, DEFAULT_SETTINGS, filename, formatBytes} from "./core.js";
import {toMp4} from "./remux-client.js";
const $ = id => document.getElementById(id);
const MAX_BYTES = 512 * 1024 ** 2;
let item, playlist, controller, objectUrl, activeDownload, busy = false;
function status(text, error = false) { $("status").textContent = text; $("status").classList.toggle("error", error); }
function showSavedName(path) { if (path) $("outputName").textContent = `保存文件：${path.split(/[\\/]/).pop()}`; }

// Read progressively so an oversized response cannot exhaust memory before checking the limit.
async function fetchBytes(url, signal, limit, onBytes = () => {}) {
  const timeout = AbortSignal.timeout(45000);
  const response = await fetch(url, {credentials:"include", signal: AbortSignal.any([signal, timeout])});
  if (!response.ok) throw new Error(`服务器返回 HTTP ${response.status}，可能需要登录或重新获取链接。`);
  if (Number(response.headers.get("content-length")) > limit) { await response.body?.cancel(); throw new Error("文件超过大小上限。"); }
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error("文件超过大小上限。");
      onBytes(value.byteLength); chunks.push(value);
    }
  } catch(e) { await reader.cancel().catch(() => {}); throw e; }
  return {chunks, size, finalUrl: response.url};
}
async function loadPlaylist(url, signal) {
  const result = await fetchBytes(url, signal, 2 * 1024 ** 2);
  const text = await new Blob(result.chunks).text();
  // Use the final response URL for relative paths after redirects.
  return parseHls(text, result.finalUrl);
}
function release() {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    chrome.storage.session.remove(`download-name:${objectUrl}`).catch(console.error);
  }
  objectUrl = null; activeDownload = null;
}
chrome.downloads.onChanged.addListener(delta => {
  if (delta.id !== activeDownload) return;
  showSavedName(delta.filename?.current);
  if (delta.state?.current === "complete") { status("下载完成，视频已保存到本机。"); release(); $("start").disabled = false; }
  if (delta.state?.current === "interrupted") { status(`保存中断：${delta.error?.current || "请重试"}`, true); release(); $("start").disabled = false; }
});
$("cancel").onclick = () => controller?.abort();
$("start").onclick = async () => {
  if (busy || activeDownload != null) return;
  busy = true; const runController = new AbortController(); controller = runController; const signal = runController.signal;
  $("start").disabled = true; $("cancel").disabled = false; $("quality").disabled = true; $("progress").value = 0;
  try {
    let media = playlist;
    if (playlist.variants.length) {
      const variant = playlist.variants[Number($("quality").value)];
      if (variant.audio) throw new Error("此清晰度使用独立音轨，当前版本无法合并。请导出清单使用其他工具处理。");
      media = await loadPlaylist(variant.url, signal);
    }
    if (media.variants.length) throw new Error("暂不支持多层主清单。");
    if (!media.ended) throw new Error("此链接为直播或尚未结束的播放列表，暂不支持下载。");
    if (!media.segments.length) throw new Error("播放列表中没有可下载的分片。");
    if (media.segments.length > 6000) throw new Error("分片数量超过 6,000，请使用专用下载工具。");
    const urls = [...(media.init ? [media.init] : []), ...media.segments];
    const parts = new Array(urls.length); let bytes = 0, complete = 0, cursor = 0;
    async function worker() {
      while (cursor < urls.length) {
        const index = cursor++;
        signal.throwIfAborted();
        const result = await fetchBytes(urls[index], signal, MAX_BYTES, amount => {
          bytes += amount; if (bytes > MAX_BYTES) throw new Error("视频超过 512 MB 内存处理上限，请使用专用下载工具。");
        });
        signal.throwIfAborted();
        parts[index] = new Blob(result.chunks);
        complete++;
        $("progress").value = complete / urls.length * 100;
        status(`正在下载 ${complete} / ${urls.length} 个分片 · ${formatBytes(bytes)}`);
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    signal.throwIfAborted();
    release();
    let extension = media.init ? "mp4" : "ts";
    let output;
    if (!media.init && item.outputFormat === "mp4") {
      status("分片下载完成，正在无损封装为 MP4…");
      output = await toMp4(parts, signal, (done, total) => status(`正在封装 MP4 · ${done} / ${total}`));
      extension = "mp4";
    } else output = new Blob(parts, {type: media.init ? "video/mp4" : "video/mp2t"});
    signal.throwIfAborted();
    objectUrl = URL.createObjectURL(output);
    const config = {...DEFAULT_SETTINGS, ...(await chrome.storage.local.get("settings")).settings};
    const outputName = filename(item, config.folder, extension);
    $("outputName").textContent = `输出文件：${outputName}`;
    await chrome.storage.session.set({[`download-name:${objectUrl}`]: outputName});
    status("分片已合并，等待 Chrome 保存。请保持此页面打开直至下载完成。");
    $("cancel").disabled = true;
    activeDownload = await chrome.downloads.download({url:objectUrl, filename:outputName, saveAs:config.saveAs, conflictAction:"uniquify"});
    const [download] = await chrome.downloads.search({id:activeDownload});
    showSavedName(download?.filename);
    if (download?.state === "complete") { status("下载完成，视频已保存到本机。"); release(); }
    else if (download?.state === "interrupted") { throw new Error(`保存中断：${download.error || "请重试"}`); }
  } catch(e) {
    const cancelled = e.name === "AbortError";
    runController.abort(); release();
    status(cancelled ? "已取消下载，可重新开始。" : e.name === "TimeoutError" ? "服务器响应超时，请重试。" : e.message, !cancelled);
  } finally { busy = false; $("cancel").disabled = true; $("start").disabled = activeDownload != null; $("quality").disabled = false; }
};
window.addEventListener("beforeunload", event => { if (busy || activeDownload != null) { event.preventDefault(); event.returnValue = ""; } });
window.addEventListener("pagehide", () => { controller?.abort(); release(); });
try {
  const job = new URLSearchParams(location.search).get("job");
  item = (await chrome.storage.session.get(`job:${job}`))[`job:${job}`];
  if (!item) throw new Error("任务已过期，请在扩展中重新选择视频。");
  $("title").textContent = item.title; $("source").textContent = item.selectedVariant?.url || item.url;
  controller = new AbortController();
  playlist = await loadPlaylist(item.selectedVariant?.url || item.url, controller.signal);
  $("quality").replaceChildren();
  const variants = playlist.variants.length ? playlist.variants : [{resolution:item.selectedVariant?.resolution || "原始清晰度", bandwidth:item.selectedVariant?.bandwidth || 0}];
  variants.forEach((variant, index) => {
    const option = document.createElement("option"); option.value = index;
    option.textContent = `${variant.resolution || "自动清晰度"}${variant.bandwidth ? ` · ${(variant.bandwidth / 1e6).toFixed(2)} Mbps` : ""}${variant.audio ? " · 独立音轨（暂不支持）" : ""}`;
    option.disabled = Boolean(variant.audio); $("quality").append(option);
  });
  const firstSupported = variants.findIndex(v => !v.audio);
  if (firstSupported < 0) throw new Error("所有清晰度均使用独立音轨，当前版本无法合并。");
  $("quality").value = firstSupported;
  $("quality").disabled = false; $("start").disabled = false;
  status(playlist.variants.length ? "清单解析完成，选择清晰度后即可开始。" : `已发现 ${playlist.segments.length} 个分片 · 时长约 ${Math.round(playlist.duration / 60)} 分钟`);
  if (item.autoStart && item.selectedVariant) {
    // Consume once so refreshing this page does not silently start another save.
    await chrome.storage.session.set({[`job:${job}`]: {...item, autoStart: false}});
    await $("start").onclick();
  }
} catch(e) { status(e.message, true); }
