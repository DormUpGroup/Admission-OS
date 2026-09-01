import { BACHELOR_DIRECTIONS } from "../src/lib/questionnaire-programs";
import { QUESTIONNAIRE_DIRECTION_MIUR } from "../src/lib/program-matching/miur-direction-map";
import { fieldTagsToDirectionSlices } from "../src/lib/program-matching/taxonomy";
import { resolveClasseId } from "../src/server/services/program-matching/miur-classi";

async function main() {
  const unresolved: string[] = [];
  for (const d of BACHELOR_DIRECTIONS) {
    const row = QUESTIONNAIRE_DIRECTION_MIUR[d];
    if (!row) {
      console.log("NO_MAP", d);
      continue;
    }
    const slices = fieldTagsToDirectionSlices([d], { degreeLevel: "BACHELOR" });
    const master = fieldTagsToDirectionSlices([d], { degreeLevel: "MASTER" });
    const codes = [
      ...new Set(
        [...slices, ...master]
          .map((s) => s.classeCode)
          .filter(Boolean) as string[]
      ),
    ];
    for (const code of codes) {
      const id = await resolveClasseId(code);
      if (id == null) unresolved.push(`${d} → ${code}`);
    }
    console.log(
      "OK",
      d,
      "| B:",
      slices.map((s) => s.classeCode).join(","),
      "| M:",
      master.map((s) => s.classeCode).join(",")
    );
  }
  console.log("\nunresolved codes", unresolved.length);
  for (const u of unresolved) console.log(" ", u);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
