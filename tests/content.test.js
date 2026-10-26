import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import vm from "node:vm";
const source = await readFile(new URL("../extension/content.js",import.meta.url),"utf8");
function scan({json, og, heading, frame = false, url = "blob:https://page.example/123", videoTitle} = {}) {
  const messages = []; let rescan;
  const document = {
    title:"网页标题", documentElement:{},addEventListener() {},
    querySelectorAll(selector) {
      if (selector.includes("ld+json")) return json ? [{textContent:JSON.stringify(json)}] : [];
      if (selector === "video,audio") return [{tagName:"VIDEO",currentSrc:url,videoWidth:1280,videoHeight:720,getAttribute: key => key === "title" ? videoTitle : null,querySelectorAll:() => []}];
      return [];
    },
    querySelector(selector) {
      if (selector.includes("og:title")) return og ? {content:og} : null;
      if (selector === "h1") return heading ? {textContent:heading} : null;
      return null;
    }
  };
  const window = {}; window.top = frame ? {} : window;
  vm.runInNewContext(source,{document,window,chrome:{runtime:{sendMessage(value) {messages.push(value);return Promise.resolve();},onMessage:{addListener(fn) {rescan = fn;}}}},performance:{getEntriesByType:() => []},MutationObserver:class {observe() {}},PerformanceObserver:class {observe() {}},setTimeout() {},clearTimeout() {}});
  return {messages,document,rescan};
}
test("blob players still report structured video titles for network-only HLS records", () => {
  const app = scan({json:{"@graph":[{"@type":["VideoObject"],name:"真实影片名称"}]},og:"站点标题"});
  assert.equal(app.messages[0].type,"PAGE_METADATA"); assert.equal(app.messages[0].title,"真实影片名称"); assert.equal(app.messages[0].priority,55);
  assert.equal(app.messages.some(message => message.type === "FOUND"),false);
});
test("metadata falls back to OG, heading or document title and rescans after changes", () => {
  assert.equal(scan({og:"影片 OG 标题",heading:"标题一"}).messages[0].title,"影片 OG 标题");
  assert.equal(scan({heading:"影片主标题"}).messages[0].title,"影片主标题");
  const app = scan(); assert.equal(app.messages[0].title,"网页标题");
  app.document.title = "切换后的下一集"; app.rescan({type:"SCAN"});
  assert.equal(app.messages.at(-1).title,"切换后的下一集");
});
test("iframe titles are scoped to media and explicit video titles remain available", () => {
  const app = scan({frame:true,url:"https://cdn.example/index.m3u8",videoTitle:"播放器里的影片名称"});
  assert.equal(app.messages.some(message => message.type === "PAGE_METADATA"),false);
  const found = app.messages.find(message => message.type === "FOUND");
  assert.equal(found.items[0].title,"播放器里的影片名称"); assert.equal(found.items[0].titlePriority,60);
});
