const fs = require("fs");
const path = require("path");
const files = ["u-main.js", "u-1.js", "u-2.js", "u-3.js", "u-4.js", "u-5.js", "u-6.js", "u-7.js", "u-cerca-chunk.js"];
for (const f of files) {
  const p = path.join(process.env.TEMP, f);
  if (!fs.existsSync(p)) continue;
  const t = fs.readFileSync(p, "utf8");
  for (const needle of ["offerta-formativa", "cerca-corsi", "lista-classi", "uitBackendBaseUrl"]) {
    let from = 0;
    let n = 0;
    while ((from = t.indexOf(needle, from)) !== -1 && n < 3) {
      console.log(`\n=== ${f} :: ${needle} @${from} ===`);
      console.log(t.slice(Math.max(0, from - 300), from + 500));
      from += needle.length;
      n++;
    }
  }
}
