const fs = require("fs");
const t = fs.readFileSync(require("path").join(process.env.TEMP, "u-1.js"), "utf8");

const i = t.indexOf('{it:"Inglese"');
console.log("lingua map:\n", t.slice(i - 200, i + 250));

const j = t.indexOf("I LIVELLO");
console.log("\ntipoLaurea UI:\n", t.slice(j - 400, j + 700));

const k = t.indexOf('value:"LT"');
console.log("\nLT:\n", t.slice(Math.max(0, k - 100), k + 150));

for (const code of ["EN", "IT", "L", "LM", "LCU", "CU", "1", "2", "3", "C", "B", "P"]) {
  const re = new RegExp(`value:\"${code}\"`, "g");
  const count = [...t.matchAll(re)].length;
  if (count) console.log(`value:${code} count=${count}`);
}

// Try live with better params
async function trySearch(q) {
  const url = new URL("https://universitaly-backend.cineca.it/api/offerta-formativa/cerca-corsi");
  for (const [k, v] of Object.entries(q)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      Origin: "https://www.universitaly.it",
      Referer: "https://www.universitaly.it/it/cerca-corsi",
    },
  });
  const json = await res.json();
  const u = json.universita || {};
  console.log("\nQUERY", q);
  console.log("status", res.status, "uni", u.totalResults, "afam", json.afam?.totalResults);
  if (u.corsi?.[0]) console.log("sample", JSON.stringify(u.corsi[0], null, 2));
}

(async () => {
  await trySearch({ searchText: "Economics", lingua: "EN", order: "ASC" });
  await trySearch({ searchText: "Economics", lingua: "en", order: "ASC" });
  await trySearch({ searchText: "Economics", order: "ASC" });
  await trySearch({ searchText: "economia", order: "ASC" });
  await trySearch({ lingua: "EN", area: "13", order: "ASC" });
  await trySearch({ lingua: "EN", tipoLaurea: "1", order: "ASC" });
  await trySearch({ lingua: "EN", durata: "3", order: "ASC" });
})();
