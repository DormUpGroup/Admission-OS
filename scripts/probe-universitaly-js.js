const fs = require("fs");
const path = require("path");
const dir = process.env.TEMP || "/tmp";
const files = fs.readdirSync(dir).filter((f) => /^u(-main)?(-\d)?\.js$/.test(f) || /^u-\d\.js$/.test(f) || f === "u-main.js");
const allFiles = ["u-main.js", "u-1.js", "u-2.js", "u-3.js", "u-4.js", "u-5.js", "u-6.js", "u-7.js"];
const hits = new Set();
const pathHits = new Set();

for (const f of allFiles) {
  const p = path.join(dir, f);
  if (!fs.existsSync(p)) continue;
  const t = fs.readFileSync(p, "utf8");
  console.log(f, t.length);
  for (const m of t.matchAll(/universitaly-backend[^"'`\s]*/g)) hits.add(m[0]);
  for (const m of t.matchAll(/uitBackend[^"'`\s]*/g)) hits.add(m[0]);
  for (const m of t.matchAll(/["'`](\/(?:api|public|corsi|course|search|offerta|atenei)[^"'`]{0,120})["'`]/gi))
    pathHits.add(m[1]);
  for (const m of t.matchAll(/["'`]([A-Za-z0-9_\/\-]*corsi[A-Za-z0-9_\/\-]*)["'`]/gi))
    pathHits.add(m[1]);
  for (const m of t.matchAll(/["'`]([^"'`]*(?:search|filter|lingua|accesso|erogazione|classe)[^"'`]*)["'`]/gi)) {
    if (m[1].length < 120) pathHits.add(m[1]);
  }
}

console.log("\n=== BACKEND HITS ===");
console.log([...hits].join("\n"));
console.log("\n=== PATH-ISH ===");
console.log([...pathHits].sort().slice(0, 200).join("\n"));
