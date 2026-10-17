// One local dry run against a snapshot file. No network and no database.
import {readFileSync} from "node:fs";
import {dryRun, dryRunSequence, formatDryRun} from "./dry-run.mjs";

function argValue(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  return args[index + 1];
}

const args = process.argv.slice(2);
const file = args.find(arg => !arg.startsWith("--") && args[args.indexOf(arg) - 1] !== "--runs" && args[args.indexOf(arg) - 1] !== "--cadence");
if (!file || file.includes("://")) {
  console.error("Usage: node market/dry-run-cli.mjs <local-snapshot.json> [--runs N] [--cadence hours]");
  process.exit(2);
}
let snapshot;
try {
  snapshot = JSON.parse(readFileSync(file, "utf8"));
} catch {
  console.error("The snapshot file could not be read.");
  process.exit(2);
}
const runs = argValue(args, "--runs");
const cadence = argValue(args, "--cadence");
const report = runs == null && cadence == null
  ? dryRun(snapshot)
  : dryRunSequence(snapshot, {
    runs: runs == null ? 2 : Number(runs),
    cadenceHours: cadence == null ? 12 : Number(cadence)
  });
console.log(formatDryRun(report));
console.log("");
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
