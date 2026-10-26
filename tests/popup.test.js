import test from "node:test";
import assert from "node:assert/strict";
import {DEFAULT_SETTINGS} from "../extension/core.js";

class Element {
  children = []; textContent = ""; value = ""; disabled = false; hidden = false; attrs = {};
  constructor(tagName = "div") {this.tagName = tagName;}
  classList = {toggle() {}};
  append(...nodes) {this.children.push(...nodes);}
  replaceChildren(...nodes) {this.children = nodes;}
  setAttribute(name,value) {this.attrs[name] = value;}
}
function walk(node) {return [node,...node.children.flatMap(walk)];}
async function until(predicate) {for (let i=0;i<40;i++) {if (predicate()) return;await new Promise(resolve => setImmediate(resolve));} assert.fail("UI did not settle");}
test("popup updates size when choosing quality and passes edited original name and MP4 format to download", async () => {
  const nodes = new Map(), messages = [];
  const get = id => {if (!nodes.has(id)) nodes.set(id,new Element());return nodes.get(id);};
  globalThis.document = {getElementById:get,createElement:tag => new Element(tag),querySelectorAll:() => []};
  globalThis.chrome = {
    runtime:{getManifest() {return {version:"0.2.1"};},async sendMessage(message) {
      messages.push(message);
      if (message.type === "LIST") return {items:[{id:"hls1",type:"hls",title:"原片.m3u8",url:"https://cdn.example/master.m3u8",size:100}],settings:{...DEFAULT_SETTINGS,minSizeMB:10}};
      return {ok:true};
    }},
    storage:{onChanged:{addListener() {}}},
    tabs:{async query() {return [{id:7,url:"https://page.example/",title:"网页标题"}];},async sendMessage() {}}
  };
  globalThis.fetch = async url => {
    const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=4000000,RESOLUTION=1920x1080\n1080.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=1280x720\n720.m3u8';
    const response = new Response(url.endsWith("master.m3u8") ? master : "#EXTM3U\n#EXTINF:10,\n1.ts\n#EXT-X-ENDLIST");
    Object.defineProperty(response,"url",{value:url});return response;
  };
  await import("../extension/popup.js");
  const all = () => walk(get("mediaList"));
  const find = predicate => all().find(predicate);
  const quality = () => find(node => node.attrs["aria-label"] === "选择视频清晰度");
  const download = () => find(node => node.tagName === "button" && node.textContent === "下载 ↓");
  await until(() => download() && !download().disabled);
  assert.equal(quality().children.length,2);
  assert.match(find(node => node.className === "quality-summary").textContent,/4\.8 MB.*估算/);
  const name = find(node => node.attrs["aria-label"] === "保存名称");
  assert.equal(name.value,"原片"); name.value = "自定义视频"; name.oninput();
  quality().value = "1"; quality().onchange();
  await until(() => download() && !download().disabled);
  assert.equal(find(node => node.attrs["aria-label"] === "保存名称").value,"自定义视频");
  assert.match(find(node => node.className === "quality-summary").textContent,/976\.6 KB.*估算/);
  await download().onclick();
  const request = messages.find(message => message.type === "STREAM");
  assert.equal(request.quality.url,"https://cdn.example/720.m3u8");
  assert.equal(request.title,"自定义视频"); assert.equal(request.outputFormat,"mp4");
  assert.equal(find(node => node.tagName === "h2"),undefined);
  get("aboutPanel").hidden = true; get("aboutToggle").onclick();
  assert.equal(get("aboutPanel").hidden,false); assert.equal(get("settingsPanel").hidden,true);
  assert.equal(get("pageTitle").textContent,"网页标题");
  get("settingsToggle").onclick(); assert.equal(get("aboutPanel").hidden,true);
});
