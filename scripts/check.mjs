import {readFile, readdir, access} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import assert from "node:assert/strict";
const root = new URL("../extension/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
assert.equal(manifest.manifest_version, 3);
const files = [manifest.background.service_worker, manifest.action.default_popup, ...manifest.content_scripts.flatMap(c => c.js)];
files.push(...Object.values(manifest.icons || {}), ...Object.values(manifest.action.default_icon || {}));
for (const file of files) await access(new URL(file, root));
for (const file of ["remux-worker.js", "vendor/mux.min.js", "vendor/mux.LICENSE"]) await access(new URL(file, root));
for (const file of await readdir(root)) {
  if (file.endsWith(".js")) execFileSync(process.execPath, ["--check", new URL(file, root).pathname.replace(/^\/([A-Za-z]:)/, "$1")], {stdio:"inherit"});
  if (file.endsWith(".html")) {
    const html = await readFile(new URL(file, root), "utf8");
    for (const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) await access(new URL(match[1], root));
    assert(!/\son\w+=/.test(html), "No inline event handlers allowed under extension CSP");
  }
}
console.log("Manifest, JavaScript syntax, HTML references and CSP checks passed.");
