const base = "https://universitaly-backend.cineca.it";

async function get(path, query = {}) {
  const url = new URL(base + path);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    url.searchParams.set(k, String(v));
  }
  console.log("\nGET", url.toString());
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "ImmigromeOSProbe/1.0",
      Origin: "https://www.universitaly.it",
      Referer: "https://www.universitaly.it/it/cerca-corsi",
    },
  });
  const text = await res.text();
  console.log("status", res.status, "len", text.length);
  console.log("headers", Object.fromEntries([...res.headers.entries()].filter(([k]) => /content|allow|access|cors/i.test(k))));
  try {
    const json = JSON.parse(text);
    const preview = JSON.stringify(json, null, 2);
    console.log(preview.slice(0, 4000));
    return json;
  } catch {
    console.log(text.slice(0, 1000));
    return null;
  }
}

(async () => {
  await get("/api/offerta-formativa/lista-classi");
  await get("/api/usocomune/province");
  await get("/api/offerta-formativa/cerca-corsi", {
    searchText: "Economics",
    lingua: "inglese",
    tipoLaurea: "L",
    order: "ASC",
  });
  await get("/api/offerta-formativa/cerca-corsi", {
    searchText: "Computer Science",
    lingua: "inglese",
    area: "1",
    order: "ASC",
  });
  await get("/api/offerta-formativa/cerca-corsi", {
    lingua: "inglese",
    tipoLaurea: "L",
    area: "13",
    order: "ASC",
  });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
