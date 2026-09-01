const fs = require("fs");
const t = fs.readFileSync(require("path").join(process.env.TEMP, "u-1.js"), "utf8");
// Extract option values near lingua / tipoLaurea / tipoAccesso
for (const needle of ["lingua", "tipoLaurea", "tipoAccesso", "modalitaErogazione", "value:\"L\"", "inglese", "INGLESE", "English"]) {
  let from = 0, n = 0;
  while ((from = t.indexOf(needle, from)) !== -1 && n < 5) {
    if (needle === "lingua" || needle === "tipoLaurea") {
      // only print nearby value= patterns
    }
    console.log(`\n${needle}@${from}:`, t.slice(from, from + 250).replace(/\s+/g, " "));
    from += needle.length;
    n++;
  }
}
