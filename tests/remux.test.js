import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {transmuxParts} from "../extension/remux.js";

test("real MPEG-TS with video and audio becomes MP4 containing both tracks", async () => {
  const ts = await readFile(new URL("./fixtures/sample.ts",import.meta.url));
  const progress = [];
  const blob = await transmuxParts([new Blob([ts])], (...value) => progress.push(value));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.equal(blob.type,"video/mp4"); assert.equal(Buffer.from(bytes.slice(4,8)).toString(),"ftyp");
  const types = []; for (let cursor = 0; cursor < bytes.length;) {
    const view = new DataView(bytes.buffer,bytes.byteOffset + cursor); const length = view.getUint32(0);
    assert.ok(length >= 8 && cursor + length <= bytes.length); types.push(Buffer.from(bytes.slice(cursor+4,cursor+8)).toString()); cursor += length;
  }
  for (const type of ["ftyp","moov","moof","mdat"]) assert.ok(types.includes(type));
  const tracks = globalThis.muxjs.mp4.probe.tracks(bytes);
  assert.ok(tracks.some(track => track.type === "video")); assert.ok(tracks.some(track => track.type === "audio"));
  assert.deepEqual(progress,[[1,1]]);
});
test("invalid TS data is rejected rather than simply renamed to MP4", async () => {
  await assert.rejects(transmuxParts([new Blob(["not a video"])]),/无法.*MP4/);
});
