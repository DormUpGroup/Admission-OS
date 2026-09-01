const fs = require("fs");
const path = require("path");
const t = fs.readFileSync(path.join(process.env.TEMP, "u-main.js"), "utf8");

// Find cerca-corsi call context
const idx = t.indexOf("offerta-formativa/cerca-corsi");
console.log("idx", idx);
console.log(t.slice(Math.max(0, idx - 800), idx + 800));

const idx2 = t.indexOf("lista-classi");
console.log("\n\n=== lista-classi context ===\n");
console.log(t.slice(Math.max(0, idx2 - 400), idx2 + 400));

// Look for payload construction near searchType / tipoClasse
const markers = ["searchType", "tipoClasse", "areaTematica", "codiceAteneo", "pageSize", "pageNumber", "ordinamento"];
for (const m of markers) {
  const i = t.indexOf(m);
  if (i >= 0) console.log(`\nfirst ${m} @${i}:`, t.slice(i - 120, i + 200).replace(/\n/g, " "));
}
