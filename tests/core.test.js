import test from "node:test";
import assert from "node:assert/strict";
import {mediaType, parseHls, filename, safeName, isBlocked, DEFAULT_SETTINGS, originalName, nameStem, suggestedName} from "../extension/core.js";
test("detects signed URLs and MIME-only endpoints without listing transport fragments", () => {
  assert.equal(mediaType("https://cdn.example/play?id=1", "video/mp4; charset=utf-8"), "video");
  assert.equal(mediaType("https://cdn.example/A.M3U8?token=x"), "hls");
  assert.equal(mediaType("https://cdn.example/play", "application/dash+xml"), "dash");
  assert.equal(mediaType("https://cdn.example/a.mp3"), "audio");
  for (const url of ["blob:https://example.com/a", "javascript:alert(1)", "https://example.com/a.ts", "https://example.com/a.m4s"]) assert.equal(mediaType(url), null);
});
test("master playlists preserve signed URLs, quoted codecs and order qualities", () => {
  const result = parseHls('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1280x720,CODECS="avc1,mp4a"\n720.m3u8?token=x\n#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1920x1080,AUDIO="audio"\n/1080.m3u8', "https://cdn.example/path/master.m3u8?token=master");
  assert.equal(result.variants[0].resolution, "1920x1080");
  assert.equal(result.variants[0].audio, "audio");
  assert.equal(result.variants[1].url, "https://cdn.example/path/720.m3u8?token=x");
  assert.equal(result.variants[1].codecs, "avc1,mp4a");
});
test("VOD keeps segment order and initialization fragment; distinguishes live", () => {
  const result = parseHls('\uFEFF#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:4.5,\na.m4s\n#EXTINF:5,\nb.m4s\n#EXT-X-ENDLIST', "https://cdn.example/v/index.m3u8");
  assert.deepEqual(result.segments, ["https://cdn.example/v/a.m4s", "https://cdn.example/v/b.m4s"]);
  assert.equal(result.init, "https://cdn.example/v/init.mp4"); assert.equal(result.duration, 9.5); assert.equal(result.ended, true);
  assert.equal(parseHls("#EXTM3U\n#EXTINF:4,\na.ts", "https://cdn.example/").ended, false);
});
test("rejects encryption, DRM, byte ranges, discontinuities and invalid protocols", () => {
  for (const line of ['#EXT-X-KEY:METHOD=AES-128,URI="key"', '#EXT-X-SESSION-KEY:METHOD=SAMPLE-AES,URI="key"', '#EXT-X-BYTERANGE:20@0', '#EXT-X-MAP:URI="init.mp4",BYTERANGE="20@0"', '#EXT-X-DISCONTINUITY', 'file:///secret']) assert.throws(() => parseHls(`#EXTM3U\n${line}`, "https://cdn.example/"));
  assert.throws(() => parseHls("<html>expired</html>", "https://cdn.example/"));
  assert.doesNotThrow(() => parseHls("#EXTM3U\n#EXT-X-KEY:METHOD=NONE\na.ts", "https://cdn.example/"));
});
test("sanitizes file paths and Windows reserved names", () => {
  assert.equal(safeName("../CON"), "__CON");
  assert.equal(safeName("CON"), "_CON");
  assert.equal(filename({url:"https://example.com/a.mp4", title:'测试:视频.mp4',type:"video"}, "../Movies"), "__Movies/测试_视频.mp4");
  assert.equal(filename({url:"https://example.com/a.m3u8", title:"测试",type:"hls"}, "", "ts"), "测试.ts");
});
test("blocked sites match exact hosts and subdomains, not lookalikes", () => {
  const config = {...DEFAULT_SETTINGS, blockedHosts:"example.com\nother.test"};
  assert.equal(isBlocked("https://cdn.example.com/v", config), true);
  assert.equal(isBlocked("https://notexample.com/v", config), false);
});
test("original names support UTF-8 server headers, signed URLs and a removable media suffix", () => {
  assert.equal(originalName("https://cdn.example/id", "attachment; filename*=UTF-8''%E5%8E%9F%E7%89%87.mp4"),"原片.mp4");
  assert.equal(originalName("https://cdn.example/ignored.mp4",'attachment; filename="my clip.mp4"'),"my clip.mp4");
  assert.equal(originalName("https://cdn.example/%E5%8E%9F%E7%89%87.mp4?sig=x"),"原片.mp4");
  assert.equal(originalName("https://cdn.example/play?filename=movie.mp4&token=secret"),"movie.mp4");
  assert.equal(originalName("https://cdn.example/play?token=secret"),null);
  assert.equal(nameStem("原片.m3u8"),"原片");
});
test("stream names prefer video metadata or the page title over playlist filenames", () => {
  const stream = {type:"hls",url:"https://cdn.example/index.m3u8"};
  assert.equal(suggestedName(stream,{title:"正确的视频标题",priority:50},"网站标题").title,"正确的视频标题");
  assert.equal(suggestedName(stream,null,"页面上的影片标题").title,"页面上的影片标题");
  assert.equal(suggestedName({...stream,url:"https://cdn.example/master.m3u8"},null,"").title,"视频");
  assert.equal(suggestedName({...stream,videoTitle:"播放器中的标题",videoTitlePriority:60},{title:"OG 标题",priority:50},"网站").title,"播放器中的标题");
  assert.equal(suggestedName({type:"video",url:"https://cdn.example/movie.mp4"},{title:"页面",priority:50},"页面").title,"movie.mp4");
});
