// src/generateReportFast.ts
// Fast HTML regeneration using the most recent JSON reports (for layout development)
import fs from "fs";
import path from "path";
import { main as generateReportMain } from "./generateReport.js";

// Find the most recent report directory
const docsRoot = path.join(process.cwd(), "docs");

if (!fs.existsSync(docsRoot)) {
  console.error(
    "No docs directory found. Run an audit first with 'npm run axe'."
  );
  process.exit(1);
}

const reportDirs = fs
  .readdirSync(docsRoot)
  .filter(
    (f) =>
      /^\d{4}-\d{2}-\d{2}$/.test(f) &&
      fs.statSync(path.join(docsRoot, f)).isDirectory()
  )
  .sort(); // Chronological order

if (reportDirs.length === 0) {
  console.error(
    "No report directories found. Run an audit first with 'npm run axe'."
  );
  process.exit(1);
}

// Use the most recent report directory
const latestReportDir = reportDirs[reportDirs.length - 1];

console.log(`🚀 Fast regenerating HTML report for: ${latestReportDir}`);
console.log("📁 Using existing JSON files (no new audits)");

const startTime = Date.now();
generateReportMain(latestReportDir);
const endTime = Date.now();

console.log(`✅ HTML regenerated in ${endTime - startTime}ms`);
console.log(`📄 Report available at: docs/${latestReportDir}/index.html`);
