export const UNIBO_ROOT_HTML = `<!DOCTYPE html>
<html><head><title>Business and Economics - University of Bologna</title></head>
<body>
<main>
  <h1>Business and Economics</h1>
  <p>The programme is taught in Bologna on the University campus.</p>
  <p>Campus city: Bologna.</p>
  <a href="https://corsi.unibo.it/1cycle/BusinessEconomics/how-to-enrol">How to enrol</a>
  <a href="https://www.unibo.it/en/teaching/degree-programmes">Other programmes</a>
</main>
<footer>Cookie policy Privacy menu</footer>
</body></html>`;

export const UNIBO_ENROL_HTML = `<!DOCTYPE html>
<html><head><title>How to enrol</title></head>
<body>
<main>
  <h1>How to enrol</h1>
  <div role="tab">Italy</div>
  <div role="tab">EU country</div>
  <div role="tab">Non-EU country</div>
  <div id="non-eu-country" class="tab-pane">
    <h2>Non-EU country</h2>
    <p>Applicants residing abroad outside the EU must follow the Non-EU procedure.</p>
    <details>
      <summary>Entrance exam</summary>
      <p>Non-EU applicants residing abroad must take the SAT as entrance exam for admission.</p>
      <p>The SAT Reasoning Test is required for Non-EU students applying from abroad.</p>
    </details>
    <details>
      <summary>Qualification required</summary>
      <p>Secondary school diploma.</p>
    </details>
  </div>
  <div id="eu-country" class="tab-pane">
    <h2>EU country</h2>
    <p>EU citizens do not take the SAT for this programme.</p>
  </div>
  <a href="https://corsi.unibo.it/1cycle/BusinessEconomics/how-to-enrol/bando.pdf">Call for applications PDF</a>
</main>
</body></html>`;

export const UNIBO_FIXTURE_PAGES = {
  root: {
    url: "https://corsi.unibo.it/1cycle/BusinessEconomics",
    html: UNIBO_ROOT_HTML,
    sourceDocumentId: "doc-unibo-root",
  },
  enrol: {
    url: "https://corsi.unibo.it/1cycle/BusinessEconomics/how-to-enrol",
    html: UNIBO_ENROL_HTML,
    sourceDocumentId: "doc-unibo-enrol",
  },
};
