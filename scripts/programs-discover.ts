import { TARGET_ACADEMIC_YEARS } from "../src/lib/program-matching/config";
import { universitalyAdapter } from "../src/server/services/program-ingestion/adapters/universitaly";

async function main() {
  const years = process.argv.includes("--all")
    ? [...TARGET_ACADEMIC_YEARS]
    : [TARGET_ACADEMIC_YEARS[0]];

  for (const year of years) {
    const rows = await universitalyAdapter.discover(year);
    console.log(`\n[${year}] discovered ${rows.length} programmes`);
    for (const r of rows) {
      console.log(`- ${r.universityName}: ${r.title} (${r.degreeLevel})`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
