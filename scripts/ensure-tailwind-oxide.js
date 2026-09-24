/**
 * Railway/Nixpacks: npm ci often skips @tailwindcss/oxide optional native
 * packages when the lockfile was generated on Windows (npm/cli#4828).
 * Install the matching Linux binding before `next build`.
 */
const { execSync } = require("node:child_process");

if (process.platform !== "linux") {
  process.exit(0);
}

const version = "4.3.3";
const candidates =
  process.arch === "arm64"
    ? [
        `@tailwindcss/oxide-linux-arm64-gnu@${version}`,
        `@tailwindcss/oxide-linux-arm64-musl@${version}`,
      ]
    : [
        `@tailwindcss/oxide-linux-x64-gnu@${version}`,
        `@tailwindcss/oxide-linux-x64-musl@${version}`,
      ];

let installed = false;
for (const pkg of candidates) {
  try {
    console.log(`[ensure-tailwind-oxide] installing ${pkg}`);
    execSync(`npm i --no-save ${pkg}`, { stdio: "inherit" });
    installed = true;
  } catch {
    console.warn(`[ensure-tailwind-oxide] skip ${pkg} (wrong libc or unavailable)`);
  }
}

if (!installed) {
  console.warn(
    "[ensure-tailwind-oxide] no native package installed; next build may fail on oxide",
  );
}
