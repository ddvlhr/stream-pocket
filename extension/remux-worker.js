import {transmuxParts} from "./remux.js";
self.onmessage = async event => {
  try {
    const blob = await transmuxParts(event.data.parts, (done, total) => self.postMessage({type: "progress", done, total}));
    self.postMessage({type: "done", blob});
  } catch(error) { self.postMessage({type: "error", error: error.message}); }
};
