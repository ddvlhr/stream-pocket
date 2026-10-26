export function toMp4(parts, signal, onProgress) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./remux-worker.js", import.meta.url), {type: "module"});
    const finish = (error, blob) => { worker.terminate(); signal.removeEventListener("abort", abort); error ? reject(error) : resolve(blob); };
    const abort = () => finish(new DOMException("已取消", "AbortError"));
    signal.addEventListener("abort", abort, {once: true});
    if (signal.aborted) { abort(); return; }
    worker.onmessage = ({data}) => {
      if (data.type === "progress") onProgress(data.done, data.total);
      if (data.type === "done") finish(null, data.blob);
      if (data.type === "error") finish(new Error(data.error));
    };
    worker.onerror = () => finish(new Error("MP4 封装失败，请重新加载扩展或选择 TS 格式。"));
    worker.postMessage({parts});
  });
}
