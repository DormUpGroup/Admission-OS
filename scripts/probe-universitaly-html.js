const fs = require("fs");
const path = require("path");
const htmlPath = path.join(process.env.TEMP || "/tmp", "universitaly-cerca.html");
const h = fs.readFileSync(htmlPath, "utf8");
console.log("len", h.length);

const srcs = [...h.matchAll(/src=["']([^"']+)["']/g)].map((m) => m[1]);
console.log("\n=== SCRIPTS ===");
console.log([...new Set(srcs)].join("\n"));

const hrefs = [...h.matchAll(/href=["']([^"']+)["']/g)].map((m) => m[1]);
const interesting = [...new Set(hrefs)].filter(
  (x) => /js|api|corsi|chunk|static|assets/i.test(x)
);
console.log("\n=== INTERESTING HREFS ===");
console.log(interesting.join("\n"));

const urls = [
  ...h.matchAll(/https?:\/\/[^\s"'<>]+/g),
  ...h.matchAll(/\/(?:api|graphql|v\d)[^\s"'<>]*/gi),
].map((m) => m[0]);
console.log("\n=== URL-LIKE ===");
console.log([...new Set(urls)].slice(0, 120).join("\n"));

console.log("\n=== HEAD ===");
console.log(h.slice(0, 2500));

const __nuxt = h.includes("__NUXT__") || h.includes("nuxt");
const next = h.includes("__NEXT_DATA__");
const ng = h.includes("ng-app") || h.includes("angular");
const react = h.includes("react");
console.log("\n=== FRAMEWORK HINTS ===", { __nuxt, next, ng, react });

const inline = [...h.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)]
  .map((m) => m[1])
  .filter((t) => t && t.trim().length > 20);
console.log("\n=== INLINE SCRIPT COUNT ===", inline.length);
inline.slice(0, 3).forEach((t, i) => {
  console.log(`\n--- inline ${i} (${t.length}) ---\n`, t.slice(0, 1500));
});
