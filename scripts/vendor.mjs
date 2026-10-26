import {mkdir, copyFile} from "node:fs/promises";
const root = new URL("../", import.meta.url);
await mkdir(new URL("extension/vendor/", root), {recursive: true});
await copyFile(new URL("node_modules/mux.js/dist/mux.min.js", root), new URL("extension/vendor/mux.min.js", root));
await copyFile(new URL("node_modules/mux.js/LICENSE", root), new URL("extension/vendor/mux.LICENSE", root));
console.log("Bundled mux.js and its Apache-2.0 license locally.");
