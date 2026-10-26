import test from "node:test";
import assert from "node:assert/strict";
import {inspectHls, inspectQuality, sizeLabel} from "../extension/hls-info.js";
import {parseHls} from "../extension/core.js";
const base = "https://cdn.example/index.m3u8";
const vod = "#EXTM3U\n#EXTINF:4,\n1.ts\n#EXTINF:6,\n2.ts\n#EXT-X-ENDLIST";
function mock(routes) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({url, method: options.method || "GET"});
    const route = routes[url]; assert.ok(route, `Unexpected request ${url}`);
    const response = new Response(route.body || "", {status: route.status || 200, headers: route.headers});
    Object.defineProperty(response, "url", {value: route.finalUrl || url}); return response;
  }; return calls;
}
test("popup parses quality URLs after redirect and estimates size from average bitrate and duration", async () => {
  const calls = mock({
    [base]: {body:'#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=8000000,AVERAGE-BANDWIDTH=4000000,RESOLUTION=1920x1080\nhigh.m3u8',finalUrl:"https://redirect.example/master.m3u8"},
    "https://redirect.example/high.m3u8": {body:vod}
  });
  const [choice] = await inspectHls({url: base}); const info = await inspectQuality(choice);
  assert.equal(choice.url, "https://redirect.example/high.m3u8");
  assert.equal(info.size, 5000000); assert.equal(info.estimated, true); assert.equal(info.extension, "ts");
  assert.match(sizeLabel(info), /估算/); assert.equal(calls.length, 2);
});
test("single-quality VOD probes all small-playlist segment headers for exact combined bytes", async () => {
  const calls = mock({[base]:{body:vod},"https://cdn.example/1.ts":{headers:{"content-length":"1000"}},"https://cdn.example/2.ts":{headers:{"content-length":"3000"}}});
  const [choice] = await inspectHls({url:base}); const info = await inspectQuality(choice);
  assert.equal(info.size,4000); assert.equal(info.estimated,false); assert.doesNotMatch(sizeLabel(info),/估算/);
  assert.deepEqual(calls.map(c => c.method),["GET","HEAD","HEAD"]);
});
test("sampled size is labelled as estimated; unavailable lengths remain unknown", async () => {
  const body = "#EXTM3U\n" + Array.from({length:10},(_,i) => `#EXTINF:2,\n${i}.ts`).join("\n") + "\n#EXT-X-ENDLIST";
  const calls = mock(Object.fromEntries([0,5,9].map(i => [`https://cdn.example/${i}.ts`,{headers:{"content-length":"1000"}}])));
  const info = await inspectQuality({media:parseHls(body,base)});
  assert.equal(info.size,10000); assert.equal(info.estimated,true); assert.equal(calls.length,3);
  mock({"https://cdn.example/1.ts":{status:405},"https://cdn.example/2.ts":{status:405}});
  const unknown = await inspectQuality({media:parseHls(vod,base)});
  assert.equal(unknown.size,null); assert.equal(sizeLabel(unknown),"大小未知");
});
test("unsupported streams are rejected before probing video sizes", async () => {
  const calls = mock({[base]:{body:"#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=key\n1.ts"}});
  await assert.rejects(inspectHls({url:base}),/加密/); assert.equal(calls.length,1);
  await assert.rejects(inspectQuality({audio:"separate"}),/独立音轨/);
  await assert.rejects(inspectQuality({media:parseHls(vod.replace("#EXT-X-ENDLIST",""),base)}),/直播/);
});
