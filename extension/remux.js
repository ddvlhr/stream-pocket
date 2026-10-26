import "./vendor/mux.min.js";

export async function transmuxParts(parts, onProgress = () => {}) {
  const muxer = new globalThis.muxjs.mp4.Transmuxer({remux: true});
  const output = []; let initialized = false, bytes = 0, frames = 0;
  muxer.on("data", segment => {
    if (!segment.data.byteLength) return;
    if (!initialized) { output.push(segment.initSegment); bytes += segment.initSegment.byteLength; initialized = true; }
    output.push(segment.data); bytes += segment.data.byteLength; frames++;
  });
  try {
    for (let index = 0; index < parts.length; index++) {
      muxer.push(new Uint8Array(await parts[index].arrayBuffer())); muxer.flush();
      if (bytes > 512 * 1024 ** 2) throw new Error("MP4 输出超过 512 MB 上限。");
      onProgress(index + 1, parts.length);
    }
    if (!frames) throw new Error("无法将此视频封装为 MP4（仅支持 H.264 / AAC），请返回弹窗选择 TS 格式。");
    return new Blob(output, {type: "video/mp4"});
  } finally { muxer.dispose(); }
}
