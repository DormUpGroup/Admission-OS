const fs = require("fs");
const t = fs.readFileSync(require("path").join(process.env.TEMP, "u-1.js"), "utf8");
// Find radio values
const vals = [...t.matchAll(/value:"([^"]+)"/g)].map((m) => m[1]);
console.log("unique values", [...new Set(vals)].join("\n"));
const labels = [...t.matchAll(/I LIVELLO|II LIVELLO|Inglese|Italiano|Libero|Ciclo unico|EN|IT|LCU|LM|LT/g)];
console.log("label hits", labels.length);
// slice around "Inglese"
let i = t.indexOf("Inglese");
console.log("Inglese ctx", t.slice(i - 200, i + 200));
i = t.indexOf('value:"EN"');
console.log("EN ctx", t.slice(Math.max(0,i-100), i+100));
i = t.indexOf("tipoLaurea");
console.log("tipoLaurea many:");
let from = 0, n=0;
while ((from = t.indexOf("tipoLaurea", from)) !== -1 && n < 8) {
  console.log(t.slice(from, from+180).replace(/\s+/g," "));
  from += 10; n++;
}
