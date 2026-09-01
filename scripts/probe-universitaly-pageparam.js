const fs = require("fs");
const t = fs.readFileSync(require("path").join(process.env.TEMP, "u-1.js"), "utf8");
for (const needle of ["currentPage", "totalPages", "pageSize", "setPage", "pagina", "page:"]) {
  let from = 0, n = 0;
  while ((from = t.indexOf(needle, from)) !== -1 && n < 4) {
    console.log(`\n${needle}@${from}:`, t.slice(from - 80, from + 200).replace(/\s+/g, " "));
    from += needle.length;
    n++;
  }
}
