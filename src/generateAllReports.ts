import fs from "fs";
import path from "path";
import { main as generateReportMain } from "./generateReport";

// Find all report directories in docs/YYYY-MM-DD
const docsRoot = path.join(process.cwd(), "docs");
const reportDirs = fs
  .readdirSync(docsRoot)
  .filter(
    (f) =>
      /^\d{4}-\d{2}-\d{2}$/.test(f) &&
      fs.statSync(path.join(docsRoot, f)).isDirectory()
  )
  .sort();

for (const dir of reportDirs) {
  process.env.REPORT_DATE = dir;
  console.log(`Regenerating report for ${dir}...`);
  generateReportMain(dir);
}
