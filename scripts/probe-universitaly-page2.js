async function go(q) {
  const u = new URL("https://universitaly-backend.cineca.it/api/offerta-formativa/cerca-corsi");
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  const res = await fetch(u, {
    headers: {
      Accept: "application/json",
      Origin: "https://www.universitaly.it",
      Referer: "https://www.universitaly.it/it/cerca-corsi",
    },
  });
  const text = await res.text();
  console.log("\n", q, res.status, text.slice(0, 200));
  try {
    const j = JSON.parse(text);
    console.log("current", j.universita?.currentPage, "total", j.universita?.totalResults, "first", j.universita?.corsi?.[0]?.nomeCorsoEn || j.universita?.corsi?.[0]?.nomeCorso);
  } catch {}
}
(async () => {
  await go({ lingua: "EN", durata: "3", area: "13", order: "ASC", page: "1" });
  await go({ lingua: "EN", durata: "3", area: "13", order: "ASC", page: "2" });
  await go({ lingua: "EN", durata: "3", area: "13", order: "ASC", searchType: "u", page: "2" });
})();
