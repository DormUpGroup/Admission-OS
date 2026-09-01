const url = new URL("https://universitaly-backend.cineca.it/api/offerta-formativa/cerca-corsi");
url.searchParams.set("lingua", "EN");
url.searchParams.set("durata", "3");
url.searchParams.set("area", "13");
url.searchParams.set("order", "ASC");
url.searchParams.set("page", "1");

fetch(url, {
  headers: {
    Accept: "application/json",
    Origin: "https://www.universitaly.it",
    Referer: "https://www.universitaly.it/it/cerca-corsi",
  },
})
  .then(async (r) => {
    const j = await r.json();
    console.log("total", j.universita.totalResults, "pages", j.universita.totalPages, "current", j.universita.currentPage);
    console.log("page size", j.universita.corsi?.length);
    console.log("keys sample", Object.keys(j.universita.corsi?.[0] || {}));
    // try page 2 via currentPage
    const url2 = new URL(url);
    url2.searchParams.set("currentPage", "2");
    return fetch(url2, {
      headers: {
        Accept: "application/json",
        Origin: "https://www.universitaly.it",
        Referer: "https://www.universitaly.it/it/cerca-corsi",
      },
    }).then(async (r2) => {
      const j2 = await r2.json();
      console.log("page2 current", j2.universita?.currentPage, "first id", j2.universita?.corsi?.[0]?.id);
      const url3 = new URL(url);
      url3.searchParams.set("pageNumber", "2");
      return fetch(url3, {
        headers: {
          Accept: "application/json",
          Origin: "https://www.universitaly.it",
          Referer: "https://www.universitaly.it/it/cerca-corsi",
        },
      }).then(async (r3) => {
        const j3 = await r3.json();
        console.log("pageNumber2 current", j3.universita?.currentPage, "first id", j3.universita?.corsi?.[0]?.id);
      });
    });
  })
  .catch(console.error);
