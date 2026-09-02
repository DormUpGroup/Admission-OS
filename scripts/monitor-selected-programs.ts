import { monitorSelectedPrograms } from "@/server/services/program-enrichment/monitor-selected";

async function main() {
  const force = process.argv.includes("--force");
  console.log("Monitoring selected programmes…", force ? "(force)" : "");
  const result = await monitorSelectedPrograms({ force });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
