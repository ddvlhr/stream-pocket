import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {transmuxParts} from "../extension/remux.js";

class Element {
  disabled = false; value = ""; textContent = ""; children = [];
  classList = {toggle() {}};
  append(child) { this.children.push(child); }
  replaceChildren() { this.children = []; }
}
let serial = 0;
async function setup(routes, jobData = {}) {
  const nodes = new Map(); const blobs = []; const saves = []; const requests = [];
  globalThis.document = {getElementById(id) { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); }, createElement() { return new Element(); }};
  globalThis.window = {addEventListener() {}};
  globalThis.location = {search:"?job=demo"};
  globalThis.chrome = {
    storage:{session:{async get() {return {"job:demo":{title:"测试",url:"https://cdn.example/master.m3u8",type:"hls",...jobData}};},async set(value) { appStorage.push(value); },async remove() {}},local:{async get() {return {};}}},
    downloads:{onChanged:{addListener() {}},async download(value) {saves.push(value); return 1;},async search() {return [{state:"complete"}];}}
  };
  const appStorage = [];
  globalThis.fetch = async (url, options) => {
    requests.push(url); options.signal.throwIfAborted();
    const route = routes[url];
    if (!route) throw new Error(`Unexpected URL: ${url}`);
    if (route.delay) await new Promise((resolve, reject) => { const timer = setTimeout(resolve, route.delay); options.signal.addEventListener("abort", () => {clearTimeout(timer); reject(new DOMException("Aborted", "AbortError"));}, {once:true}); });
    const response = new Response(route.body, {status:route.status || 200});
    Object.defineProperty(response,"url",{value:route.finalUrl || url}); return response;
  };
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = blob => {blobs.push(blob);return "blob:test";}; URL.revokeObjectURL = () => {};
  await import(`../extension/stream.js?case=${serial++}`);
  return {nodes, blobs, saves, requests, appStorage, restore() {URL.createObjectURL = originalCreate;URL.revokeObjectURL = originalRevoke;}};
}
test("HLS merges in playlist order despite out-of-order completion and resolves redirects", async () => {
  const app = await setup({
    "https://cdn.example/master.m3u8":{body:'#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2000,RESOLUTION=1920x1080\nchild.m3u8',finalUrl:"https://redirect.example/media/master.m3u8"},
    "https://redirect.example/media/child.m3u8":{body:'#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:1,\n1.m4s\n#EXTINF:1,\n2.m4s\n#EXT-X-ENDLIST'},
    "https://redirect.example/media/init.mp4":{body:"INIT",delay:25},
    "https://redirect.example/media/1.m4s":{body:"FIRST",delay:15},
    "https://redirect.example/media/2.m4s":{body:"SECOND"}
  });
  try {
    await app.nodes.get("start").onclick();
    assert.equal(await app.blobs[0].text(),"INITFIRSTSECOND");
    assert.equal(app.saves[0].filename,"StreamPocket/测试.mp4");
    assert.equal(app.appStorage[0]["download-name:blob:test"],"StreamPocket/测试.mp4");
    assert.match(app.nodes.get("status").textContent,/下载完成/);
    assert.equal(app.nodes.get("start").disabled,false);
  } finally {app.restore();}
});
test("live streams and inaccessible segments do not produce a false successful download", async () => {
  const live = await setup({"https://cdn.example/master.m3u8":{body:"#EXTM3U\n#EXTINF:1,\n1.ts"}});
  try {await live.nodes.get("start").onclick(); assert.match(live.nodes.get("status").textContent,/直播/); assert.equal(live.saves.length,0);} finally {live.restore();}
  const denied = await setup({"https://cdn.example/master.m3u8":{body:"#EXTM3U\n#EXTINF:1,\n1.ts\n#EXT-X-ENDLIST"},"https://cdn.example/1.ts":{body:"denied",status:403}});
  try {await denied.nodes.get("start").onclick(); assert.match(denied.nodes.get("status").textContent,/HTTP 403/); assert.equal(denied.saves.length,0); assert.equal(denied.nodes.get("start").disabled,false);} finally {denied.restore();}
});
test("cancelling a transfer stops saving and allows another attempt", async () => {
  const app = await setup({"https://cdn.example/master.m3u8":{body:"#EXTM3U\n#EXTINF:1,\n1.ts\n#EXT-X-ENDLIST"},"https://cdn.example/1.ts":{body:"SEGMENT",delay:100}});
  try {
    const task = app.nodes.get("start").onclick();
    setTimeout(() => app.nodes.get("cancel").onclick(),10); await task;
    assert.match(app.nodes.get("status").textContent,/已取消/); assert.equal(app.saves.length,0);
    await app.nodes.get("start").onclick();
    assert.equal(app.saves.length,1); assert.equal(await app.blobs[0].text(),"SEGMENT");
    assert.equal(app.saves[0].filename,"StreamPocket/测试.ts");
    assert.equal(app.appStorage[0]["download-name:blob:test"],"StreamPocket/测试.ts");
  } finally {app.restore();}
});
test("selected popup quality starts immediately and does not refetch the master or choose highest quality", async () => {
  const selected = {url:"https://cdn.example/720.m3u8",resolution:"1280x720",bandwidth:2000000};
  const app = await setup({"https://cdn.example/720.m3u8":{body:"#EXTM3U\n#EXTINF:1,\n1.ts\n#EXT-X-ENDLIST"},"https://cdn.example/1.ts":{body:"720VIDEO"}}, {selectedVariant:selected,autoStart:true});
  try {
    assert.equal(app.saves.length,1); assert.equal(await app.blobs[0].text(),"720VIDEO");
    assert.equal(app.requests.includes("https://cdn.example/master.m3u8"),false);
    assert.equal(app.appStorage[0]["job:demo"].autoStart,false);
    assert.equal(app.nodes.get("quality").children[0].textContent.includes("1280x720"),true);
  } finally {app.restore();}
});
test("MP4 selection performs actual transmuxing before saving, preserving the edited filename", async () => {
  const originalWorker = globalThis.Worker;
  let terminated = false;
  globalThis.Worker = class {
    async postMessage({parts}) {
      try {
        const blob = await transmuxParts(parts,(done,total) => this.onmessage({data:{type:"progress",done,total}}));
        this.onmessage({data:{type:"done",blob}});
      } catch(error) {this.onmessage({data:{type:"error",error:error.message}});}
    }
    terminate() {terminated = true;}
  };
  const bytes = await readFile(new URL("./fixtures/sample.ts",import.meta.url));
  const selectedVariant = {url:"https://cdn.example/720.m3u8",resolution:"1280x720"};
  const app = await setup({"https://cdn.example/720.m3u8":{body:"#EXTM3U\n#EXTINF:1,\n1.ts\n#EXT-X-ENDLIST"},"https://cdn.example/1.ts":{body:bytes}}, {title:"我的影片",selectedVariant,autoStart:true,outputFormat:"mp4"});
  try {
    assert.equal(app.saves[0].filename,"StreamPocket/我的影片.mp4");
    assert.equal(app.blobs[0].type,"video/mp4");
    const output = Buffer.from(await app.blobs[0].arrayBuffer()); assert.equal(output.subarray(4,8).toString(),"ftyp");
    assert.equal(terminated,true);
  } finally {app.restore(); globalThis.Worker = originalWorker;}
});
