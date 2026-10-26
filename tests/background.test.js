import test from "node:test";
import assert from "node:assert/strict";

function event() { const listeners = []; return {addListener(fn) { listeners.push(fn); }, fire(...args) { for (const fn of listeners) fn(...args); }}; }
function storage() {
  const data = {};
  return {async get(key) { return structuredClone({[key]:data[key]}); }, async set(values) { Object.assign(data, structuredClone(values)); }, async remove(key) { delete data[key]; }};
}
const runtimeEvent = event(), headers = event(), updated = event(), removed = event(), determining = event();
const downloads = [], badges = [], createdTabs = [];
globalThis.chrome = {
  storage:{session:storage(),local:storage()},
  runtime:{id:"test",onMessage:runtimeEvent,getURL:path => `chrome-extension://test/${path}`},
  webRequest:{onHeadersReceived:headers},
  tabs:{onUpdated:updated,onRemoved:removed,async get(id) { return {id,url:"https://page.example/watch",title:"演示视频"}; },async create(value) { createdTabs.push(value); }},
  action:{async setBadgeBackgroundColor() {},async setBadgeText(value) {badges.push(value);}},
  downloads:{onDeterminingFilename:determining,async download(value) {downloads.push(value);return downloads.length;}}
};
await import("../extension/background.js");
const popup = {url:"chrome-extension://test/popup.html"};
function message(value, sender = popup) { return new Promise(resolve => runtimeEvent.fire(value, sender, resolve)); }
const list = () => message({type:"LIST",tabId:7});

test("network → session → popup → native download, across page lifecycle", async () => {
  headers.fire({tabId:7,url:"https://cdn.example/movie.mp4?sig=a",statusCode:206,responseHeaders:[{name:"Content-Type",value:"video/mp4"},{name:"Content-Length",value:"100"},{name:"Content-Range",value:"bytes 0-99/9000"}]});
  const result = await list();
  assert.equal(result.items.length, 1); assert.equal(result.items[0].size, 9000);
  assert.equal(badges.at(-1).text, "1");
  await message({type:"FOUND",items:[{url:"https://cdn.example/movie.mp4?sig=a",mime:"video/mp4",width:1920,height:1080}]}, {tab:{id:7},url:"https://page.example/watch"});
  const enriched = await list(); assert.equal(enriched.items.length, 1); assert.equal(enriched.items[0].height, 1080);
  const download = await message({type:"DOWNLOAD",tabId:7,id:result.items[0].id});
  assert.equal(download.ok, true); assert.equal(downloads[0].url, result.items[0].url); assert.equal(downloads[0].filename, "StreamPocket/movie.mp4");
  const denied = await message({type:"DOWNLOAD",tabId:7,id:result.items[0].id},{tab:{id:7},url:"https://page.example/watch"});
  assert.match(denied.error, /无权/); assert.equal(downloads.length, 1);
  updated.fire(7,{status:"loading"}); assert.equal((await list()).items.length, 0);
  assert.match((await message({type:"DOWNLOAD",tabId:7,id:result.items[0].id})).error, /失效/);
});
test("disabled discovery, ignored sites, failed responses and fragments are omitted", async () => {
  await chrome.storage.local.set({settings:{enabled:false}});
  await message({type:"FOUND",items:[{url:"https://cdn.example/video.mp4"}]},{tab:{id:7}});
  assert.equal((await list()).items.length, 0);
  await chrome.storage.local.set({settings:{enabled:true,blockedHosts:"page.example"}});
  await message({type:"FOUND",items:[{url:"https://cdn.example/video.mp4"}]},{tab:{id:7}});
  assert.equal((await list()).items.length, 0);
  await chrome.storage.local.set({settings:{enabled:true}});
  headers.fire({tabId:7,url:"https://cdn.example/no.mp4",statusCode:403,responseHeaders:[]});
  headers.fire({tabId:7,url:"https://cdn.example/1.ts",statusCode:200,responseHeaders:[{name:"Content-Type",value:"video/mp2t"}]});
  assert.equal((await list()).items.length, 0);
});
test("HLS filename is suggested with its suffix even if Chrome initially supplies an extensionless name", async () => {
  for (const ext of ["ts", "mp4"]) {
    const url = `blob:chrome-extension://test/${ext}`;
    await chrome.storage.session.set({[`download-name:${url}`]:`StreamPocket/演示视频.${ext}`});
    const suggestion = await new Promise(resolve => determining.fire({byExtensionId:"test",url,filename:"C:\\Downloads\\演示视频"},resolve));
    assert.deepEqual(suggestion,{filename:`StreamPocket/演示视频.${ext}`,conflictAction:"uniquify"});
  }
  // The listener must resolve every event and leave unrelated downloads alone.
  const unrelated = await new Promise(resolve => determining.fire({byExtensionId:"another",url:"blob:chrome-extension://test/ts"},resolve));
  assert.equal(unrelated,undefined);
  const unknown = await new Promise(resolve => determining.fire({byExtensionId:"test",url:"blob:chrome-extension://test/unknown"},resolve));
  assert.equal(unknown,undefined);
});
test("popup quality selection is passed to an automatically starting download page", async () => {
  await message({type:"FOUND",items:[{url:"https://cdn.example/master.m3u8"}]},{tab:{id:7}});
  const item = (await list()).items[0];
  const quality = {url:"https://cdn.example/720.m3u8",resolution:"1280x720",bandwidth:2000000};
  assert.equal((await message({type:"STREAM",tabId:7,id:item.id,quality,title:"我的视频",outputFormat:"mp4"})).ok,true);
  const job = new URL(createdTabs.at(-1).url).searchParams.get("job");
  const data = (await chrome.storage.session.get(`job:${job}`))[`job:${job}`];
  assert.deepEqual(data.selectedVariant,quality); assert.equal(data.autoStart,true); assert.equal(data.title,"我的视频"); assert.equal(data.outputFormat,"mp4");
  assert.match((await message({type:"STREAM",tabId:7,id:item.id,quality:{url:"javascript:alert(1)"}})).error,/清晰度/);
});
test("server filename wins over a URL name, while user edits are used only for the chosen download", async () => {
  headers.fire({tabId:7,url:"https://cdn.example/original.mp4",statusCode:200,responseHeaders:[{name:"Content-Type",value:"video/mp4"},{name:"Content-Disposition",value:"attachment; filename*=UTF-8''%E5%8E%9F%E7%89%87.mp4"}]});
  const item = (await list()).items.find(i => i.url.endsWith("original.mp4"));
  assert.equal(item.title,"原片.mp4");
  await message({type:"FOUND",items:[{url:item.url,title:"网页标题"}]},{tab:{id:7}});
  assert.equal((await list()).items.find(i => i.id === item.id).title,"原片.mp4");
  await message({type:"DOWNLOAD",tabId:7,id:item.id,title:"新的名称"});
  assert.equal(downloads.at(-1).filename,"StreamPocket/新的名称.mp4");
});
test("metadata arriving after a network-only HLS discovery replaces index with the actual title", async () => {
  headers.fire({tabId:7,url:"https://cdn.example/index.m3u8",statusCode:200,responseHeaders:[{name:"Content-Type",value:"application/vnd.apple.mpegurl"}]});
  let stream = (await list()).items.find(i => i.url.endsWith("index.m3u8"));
  assert.equal(stream.title,"演示视频");
  await message({type:"PAGE_METADATA",title:"影片的真实名称",priority:55},{tab:{id:7,url:"https://page.example/watch",title:"网站"},frameId:0});
  stream = (await list()).items.find(i => i.id === stream.id); assert.equal(stream.title,"影片的真实名称");
  // A generic embedded player must not rename all media in the parent page.
  await message({type:"FOUND",items:[{url:stream.url,title:"嵌入播放器",titlePriority:15}]},{tab:{id:7},frameId:3});
  assert.equal((await list()).items.find(i => i.id === stream.id).title,"影片的真实名称");
});
