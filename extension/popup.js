import {DEFAULT_SETTINGS, formatBytes, nameStem} from "./core.js";
import {inspectHls, inspectQuality, sizeLabel} from "./hls-info.js";
const $ = id => document.getElementById(id);
let tabId, items = [], filter = "all", config = DEFAULT_SETTINGS;
const hlsStates = new Map();
const customNames = new Map();
const downloadTitle = item => customNames.get(item.id) ?? nameStem(item.title);
function status(text, error = false) { $("status").textContent = text; $("status").classList.toggle("error", error); }
async function send(message) { const result = await chrome.runtime.sendMessage(message); if (result.error) throw new Error(result.error); return result; }
function button(text, handler, className = "secondary") {
  const node = document.createElement("button"); node.textContent = text; node.className = className;
  node.onclick = async () => { node.disabled = true; try { await handler(); } catch(e) { status(e.message, true); } finally { node.disabled = false; } }; return node;
}
function loadQuality(state) {
  const choice = state.choices[state.selected];
  if (!choice || state.details.has(choice.url)) return;
  state.details.set(choice.url, {loading: true});
  inspectQuality(choice).then(info => state.details.set(choice.url, {info}), error => state.details.set(choice.url, {error: error.message})).then(render);
}
function hlsControls(item, card, actions) {
  let state = hlsStates.get(item.id);
  if (!state) {
    state = {loading: true, choices: [], selected: 0, details: new Map(), outputFormat: "mp4"}; hlsStates.set(item.id, state);
    inspectHls(item).then(choices => {
      state.choices = choices; state.loading = false;
      state.selected = Math.max(0, choices.findIndex(choice => !choice.audio));
      loadQuality(state);
    }, error => { state.loading = false; state.error = error.message; }).then(render);
  }
  const group = document.createElement("div"); group.className = "quality-picker";
  const label = document.createElement("label"); label.textContent = "清晰度";
  const select = document.createElement("select"); select.setAttribute("aria-label", "选择视频清晰度");
  if (!state.choices.length) {
    const option = document.createElement("option"); option.textContent = state.loading ? "正在读取清晰度…" : "清单读取失败"; select.append(option); select.disabled = true;
  }
  state.choices.forEach((choice, index) => {
    const option = document.createElement("option"); option.value = index;
    const resolution = choice.resolution || "原始清晰度";
    option.textContent = `${resolution}${choice.bandwidth ? ` · ${(choice.bandwidth / 1e6).toFixed(2)} Mbps` : ""}${choice.audio ? " · 独立音轨（不支持）" : ""}`;
    option.title = option.textContent;
    option.disabled = Boolean(choice.audio); select.append(option);
  });
  select.value = String(state.selected);
  select.onchange = () => {state.selected = Number(select.value); loadQuality(state); render();};
  label.append(select); group.append(label);
  const detail = state.details.get(state.choices[state.selected]?.url);
  const summary = document.createElement("p"); summary.className = "quality-summary";
  const extension = detail?.info?.extension === "mp4" ? "mp4" : state.outputFormat;
  summary.textContent = state.error || (state.loading ? "正在解析视频清单…" : detail?.error || (detail?.loading ? "正在获取视频大小…" : `${sizeLabel(detail?.info)}${detail?.info ? ` · ${Math.ceil(detail.info.duration / 60)} 分钟 · .${extension}` : ""}`));
  const overLimit = detail?.info?.size > 512 * 1024 ** 2;
  if (overLimit) summary.textContent += detail.info.estimated ? " · 预计超出 512 MB 上限" : " · 超出 512 MB 上限";
  const formatLabel = document.createElement("label"); formatLabel.textContent = "输出格式";
  const formatSelect = document.createElement("select"); formatSelect.setAttribute("aria-label", "输出格式");
  for (const [value, text] of [["mp4", "MP4 · 无损封装"], ["ts", "TS · 原始分片"]]) {
    const option = document.createElement("option"); option.value = value; option.textContent = text; formatSelect.append(option);
  }
  formatSelect.value = state.outputFormat; formatSelect.disabled = detail?.info?.extension === "mp4";
  if (formatSelect.disabled) formatSelect.value = "mp4";
  formatSelect.onchange = () => { state.outputFormat = formatSelect.value; render(); };
  formatLabel.append(formatSelect); group.append(formatLabel, summary); card.append(group);
  const download = button("下载 ↓", async () => {
    const choice = state.choices[state.selected];
    await send({type: "STREAM", tabId, id: item.id, title: downloadTitle(item), outputFormat: state.outputFormat, quality: {url: choice.url, resolution: choice.resolution, bandwidth: choice.bandwidth, audio: choice.audio}});
    status("已打开独立页面，正在下载所选清晰度");
  }, "primary");
  download.disabled = state.loading || Boolean(state.error) || !detail?.info || (overLimit && !detail.info.estimated);
  if (state.error || detail?.error) actions.append(button("重试解析", () => {hlsStates.delete(item.id); render();}));
  actions.append(download);
}
function render() {
  const visible = items.filter(item => (["hls", "dash"].includes(item.type) || !item.size || item.size >= config.minSizeMB * 1024 ** 2));
  const selected = visible.filter(item => filter === "all" || item.type === filter);
  $("count").textContent = visible.length;
  $("listLabel").textContent = `发现的媒体 · ${selected.length}`;
  $("mediaList").replaceChildren(); $("empty").hidden = selected.length > 0;
  for (const item of selected) {
    const card = document.createElement("article"); card.className = "card"; card.setAttribute("data-type", item.type);
    const top = document.createElement("div"); top.className = "card-top";
    const icon = document.createElement("div"); icon.className = "format-icon";
    const ext = new URL(item.url).pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1];
    icon.textContent = (item.type === "hls" || item.type === "dash" ? item.type : ext || item.type).toUpperCase();
    const info = document.createElement("div"); info.className = "card-info";
    const meta = document.createElement("div"); meta.className = "meta";
    meta.textContent = `${item.type === "hls" || item.type === "dash" ? "流媒体清单" : formatBytes(item.size)}${item.height ? ` · ${item.height}p` : ""}`;
    const host = document.createElement("p"); host.className = "host"; host.textContent = new URL(item.url).hostname; host.title = item.url;
    info.append(meta, host); top.append(icon, info); card.append(top);
    const nameLabel = document.createElement("label"); nameLabel.className = "filename-field";
    const nameHeading = document.createElement("span"); nameHeading.className = "field-heading"; nameHeading.textContent = "保存名称";
    const nameHint = document.createElement("span"); nameHint.className = "field-hint"; nameHint.textContent = "可编辑 · 自动添加后缀";
    nameHeading.append(nameHint); nameLabel.append(nameHeading);
    const nameInput = document.createElement("input"); nameInput.type = "text"; nameInput.maxLength = 120; nameInput.setAttribute("aria-label", "保存名称");
    nameInput.value = customNames.get(item.id) ?? nameStem(item.title);
    nameInput.oninput = () => customNames.set(item.id, nameInput.value);
    nameLabel.append(nameInput); card.append(nameLabel);
    if (item.type === "dash") { const note = document.createElement("p"); note.className = "note"; note.textContent = "已识别 DASH，当前支持导出清单，尚不支持音画合并。"; card.append(note); }
    const actions = document.createElement("div"); actions.className = "card-actions";
    actions.append(button("复制链接", async () => { await navigator.clipboard.writeText(item.url); status("链接已复制"); }));
    if (["hls", "dash"].includes(item.type)) actions.append(button("导出清单", async () => { await send({type:"DOWNLOAD", tabId, id:item.id, title: downloadTitle(item)}); status("清单已交给 Chrome 下载"); }));
    if (item.type === "hls") hlsControls(item, card, actions);
    else if (item.type !== "dash") actions.append(button("下载 ↓", async () => { await send({type: "DOWNLOAD", tabId, id:item.id, title: downloadTitle(item)}); status("已交给 Chrome 下载，可在下载记录查看进度"); }, "primary"));
    card.append(actions); $("mediaList").append(card);
  }
}
async function refresh() { if (tabId === undefined) return; const data = await send({type:"LIST",tabId}); items = data.items; config = data.settings; render(); }
document.querySelectorAll("[data-filter]").forEach(node => node.onclick = () => { filter = node.dataset.filter; document.querySelectorAll("[data-filter]").forEach(n => { n.classList.toggle("selected", n === node); n.setAttribute("aria-pressed", String(n === node)); }); render(); });
function togglePanel(panel, toggle, otherPanel, otherToggle) {
  $(panel).hidden = !$(panel).hidden; $(toggle).setAttribute("aria-expanded", String(!$(panel).hidden));
  $(otherPanel).hidden = true; $(otherToggle).setAttribute("aria-expanded", "false");
}
$("settingsToggle").onclick = () => togglePanel("settingsPanel", "settingsToggle", "aboutPanel", "aboutToggle");
$("aboutToggle").onclick = () => togglePanel("aboutPanel", "aboutToggle", "settingsPanel", "settingsToggle");
$("version").textContent = `版本 ${chrome.runtime.getManifest().version}`;
$("saveSettings").onclick = async () => {
  try {
    config = {enabled:$("enabled").checked, saveAs:$("saveAs").checked, minSizeMB:Math.max(0, Number($("minSizeMB").value) || 0), folder:$("folder").value.trim(), blockedHosts:$("blockedHosts").value.trim()};
    await chrome.storage.local.set({settings: config}); render(); status("设置已保存"); $("settingsPanel").hidden = true; $("settingsToggle").setAttribute("aria-expanded", "false");
  } catch(e) { status(e.message, true); }
};
$("scan").onclick = async () => { try { await chrome.tabs.sendMessage(tabId, {type:"SCAN"}); status("已重新扫描；仍未发现时，请刷新网页并播放视频。"); await refresh(); } catch { status("当前页面无法扫描。安装扩展后已打开的网页需要先刷新。", true); } };
$("clear").onclick = async () => { try { await send({type:"CLEAR",tabId}); await refresh(); status("已清空当前页面记录"); } catch(e) { status(e.message, true); } };
$("downloads").onclick = () => chrome.tabs.create({url:"chrome://downloads/"});
chrome.storage.onChanged.addListener((changes, area) => { if (area === "session" && changes[`tab:${tabId}`]) refresh().catch(e => status(e.message, true)); });
try {
  const [tab] = await chrome.tabs.query({active:true,currentWindow:true}); tabId = tab?.id;
  $("pageTitle").textContent = tab?.title || "当前页面";
  if (!/^https?:/.test(tab?.url || "")) { $("emptyText").textContent = "请打开普通网页并播放视频。浏览器内部页面及扩展商店无法扫描。"; $("scan").disabled = true; }
  await refresh();
  // Also refresh metadata for already-detected blob / iframe streams. Their
  // network URLs frequently contain only an index or master playlist name.
  if (/^https?:/.test(tab?.url || "")) chrome.tabs.sendMessage(tabId, {type: "SCAN"}).catch(() => {});
  for (const name of ["enabled","saveAs"]) $(name).checked = config[name];
  for (const name of ["minSizeMB","folder","blockedHosts"]) $(name).value = config[name];
} catch(e) { status(e.message, true); }
