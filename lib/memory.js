const fs = require("fs");
const path = require("path");

function createMemoryStore(filePath) {
  function readAll() {
    ensure();
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  }

  function writeAll(data) {
    ensure();
    fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
  }

  function ensure() {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(
        filePath,
        `${JSON.stringify(
          {
            updated_at: new Date().toISOString(),
            entries: {}
          },
          null,
          2
        )}\n`
      );
    }
  }

  return {
    get(key) {
      const db = readAll();
      return db.entries[key] || null;
    },
    put(key, value, meta = {}) {
      const db = readAll();
      db.entries[key] = {
        key,
        value,
        meta,
        updated_at: new Date().toISOString()
      };
      db.updated_at = new Date().toISOString();
      writeAll(db);
      return db.entries[key];
    },
    list(prefix = "") {
      const db = readAll();
      return Object.values(db.entries).filter((entry) => entry.key.startsWith(prefix));
    },
    readAll
  };
}

module.exports = { createMemoryStore };
