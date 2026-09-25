"use strict";

// A JSON document kept in memory and written to disk atomically on change.
const fs = require("fs");
const path = require("path");
const config = require("./config");

function jsonFile(name, defaults) {
  const file = path.join(config.dataDir, name);
  let data = defaults();
  try {
    data = { ...defaults(), ...JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch (e) {
    if (e.code !== "ENOENT") console.warn("Could not read", file, "-", e.message);
  }
  let timer = null;
  function write() {
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(file + ".tmp", JSON.stringify(data));
    fs.renameSync(file + ".tmp", file);
  }
  return {
    get data() { return data; },
    save() {
      clearTimeout(timer);
      timer = setTimeout(() => { try { write(); } catch (e) { console.error("Could not save", file, e.message); } }, 200);
    },
    saveNow() { clearTimeout(timer); write(); },
  };
}

module.exports = { jsonFile };
