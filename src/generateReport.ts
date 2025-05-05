// src/generateReport.ts
// Generates a comparison HTML table of all sites/domains, their pages, and accessibility scores
import fs from "fs";
import path from "path";
import { sites } from "../sites";
import { viewports } from "../config";

// Utility to get today's date as yyyy-mm-dd
function getTodayDir() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// Find all report-*.json files in the /reports/yyyy-mm-dd directory
function getReportFiles(): string[] {
  const todayDir = getTodayDir();
  const reportsDir = path.join(process.cwd(), "reports", todayDir);
  if (!fs.existsSync(reportsDir)) return [];
  const files = fs.readdirSync(reportsDir);
  return files
    .filter((f) => f.startsWith("report-") && f.endsWith(".json"))
    .map((f) => path.join(reportsDir, f));
}

// Calculate Deque accessibility score
function calculateScore(
  passes: number,
  inapplicable: number,
  violations: number,
  incomplete: number
): number {
  const total = passes + inapplicable + violations + incomplete;
  if (total === 0) return 0;
  return Math.round(((passes + inapplicable) / total) * 1000) / 10;
}

// Read and parse all reports
function parseReports(reportFiles: string[]) {
  // Also collect the homepage URL for each site
  const data: Record<
    string,
    { pages: Record<string, Record<string, number>>; url: string }
  > = {};
  for (const file of reportFiles) {
    console.log("parseReports processing:", file);
    const raw = fs.readFileSync(file, "utf-8");
    const json = JSON.parse(raw);
    const site = file.replace(/^.*report-/, "").replace(/\.json$/, "");
    console.log("site key used:", site);
    let url = "";
    const firstPage = Object.keys(json)[0];
    if (firstPage) {
      const deviceKeys = Object.keys(json[firstPage]);
      if (deviceKeys.length > 0) {
        url = json[firstPage][deviceKeys[0]].url || "";
      }
    }
    data[site] = { pages: {}, url };
    for (const page of Object.keys(json)) {
      const pageKey = page.toLowerCase();
      data[site].pages[pageKey] = {};
      for (const device of Object.keys(json[page])) {
        const deviceData = json[page][device];
        const passes = deviceData.passes?.length || 0;
        const inapplicable = deviceData.inapplicable?.length || 0;
        const violations = deviceData.violations?.length || 0;
        const incomplete = deviceData.incomplete?.length || 0;
        data[site].pages[pageKey][device] = calculateScore(
          passes,
          inapplicable,
          violations,
          incomplete
        );
      }
    }
  }
  return data;
}

function getGaugeSVG(score: number): string {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(100, score));
  let arcLength: number;
  let gapLength: number;
  if (pct === 100) {
    arcLength = circumference;
    gapLength = 0;
  } else {
    const minGapRatio = 0.03; // 3% gap for <100
    const arcRatio = (pct / 100) * (1 - minGapRatio);
    arcLength = arcRatio * circumference;
    gapLength = circumference - arcLength;
  }
  // Color logic (like Lighthouse)
  let color = "#ffa400"; // orange
  if (score >= 90) color = "#0cce6b"; // green
  else if (score < 50) color = "#ff4136"; // red
  return `
    <svg class="gauge" viewBox="0 0 120 120" width="60" height="60">
      <circle cx="60" cy="60" r="54" fill="#fff" stroke="#eee" stroke-width="12"></circle>
      <circle cx="60" cy="60" r="54" fill="none" stroke="${color}" stroke-width="12" stroke-dasharray="${circumference.toFixed(
    3
  )}" stroke-dashoffset="${gapLength.toFixed(
    2
  )}" stroke-linecap="round"></circle>
      <text x="60" y="60" text-anchor="middle" dominant-baseline="central" font-size="36" fill="#222">${score.toFixed(
        0
      )}</text>
    </svg>
  `;
}

function generateHTMLTable(
  data: Record<
    string,
    { pages: Record<string, Record<string, number>>; url: string }
  >,
  firstReportDate: Date,
  reportsDir: string
): string {
  // Use the order of product types as defined in sites.ts
  const allPages = Object.keys(sites);
  const deviceKeys = Object.keys(viewports);
  // Use the order from config.ts
  const sitesInOrder = Object.keys(sites.home);

  // Format date as '28 Apr 2025 at 14:47'
  const dateStr = firstReportDate
    .toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
    .replace(",", "")
    .replace(" ", " ")
    .replace(":", ":");

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Accessibility Comparison</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol";; background: #f8f9fa; margin: 0; }
    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 2rem 1rem;
      box-sizing: border-box;
      position: relative;
    }
    .audit-meta {
      position: absolute;
      top: 2rem;
      right: 1rem;
      font-size: 0.8em;
      color: #666;
      padding: 0.3em 0.8em;
      z-index: 2;
      text-align: right;
    }
    .timestamp { font-weight: bold; display: block; margin-top: 0.3rem; }
    h1 { text-align: left; margin-top: 0; }
    table { border-collapse: collapse; margin: 2rem 0; background: #fff; box-shadow: 0 2px 8px #0001; table-layout: fixed; width: 100%; }
    th, td { border: 0px solid #ccc; padding: 0.7em 1.2em; text-align: left; }
    th { background: #dbe6ee; color: #000; text-align: center; text-transform: capitalize; }
    tr:nth-child(even) td { background: #f2f6fa; }
    .score-cell { text-align: center; }
    .site-link { color: #000; text-decoration: none; font-weight: bold; }
    .gauge { display: block; margin: 0 auto; }
    @media (max-width: 900px) {
      .container { padding: 1rem 0.5rem; }
      table, th, td { font-size: 0.95em; }
    }
    @media (max-width: 600px) {
      .container { padding: 0.5rem 0.2rem; }
      table, th, td { font-size: 0.85em; }
      th, td { padding: 0.5em 0.3em; }
      .audit-meta { position: static; display: block; margin-bottom: 0.5em; text-align: left; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="audit-meta">
      Axe audit (EN-301-549) <span class="timestamp">${dateStr}</span>
    </div>
    <h1>Accessibility Comparison</h1>
    <table>
      <tr>
        <th style="text-align: left;">Site</th>
        ${allPages
          .map((page) =>
            deviceKeys.length > 1
              ? deviceKeys
                  .map((device) => `<th>${page} (${device})</th>`)
                  .join("")
              : `<th>${page}</th>`
          )
          .join("")}
      </tr>
`;
  for (const site of sitesInOrder) {
    const siteKey = site.replace(/\./g, "_");
    const displaySite = site;
    const siteUrl =
      data[siteKey]?.url || sites.home[site] || `https://${displaySite}`;
    html += `    <tr>\n      <td><a class="site-link" href="${siteUrl}" target="_blank" rel="noopener"><img src="https://www.google.com/s2/favicons?domain=${site}&sz=48" alt="" style="width:20px;height:20px;vertical-align:middle;margin-right:8px;object-fit:contain;">${displaySite}</a></td>\n`;
    for (const page of allPages) {
      for (const device of deviceKeys) {
        const score = data[siteKey]?.pages[page.toLowerCase()]?.[device];

        // Try to get the page URL from the report data (use correct reportsDir)
        let pageUrl = "";
        try {
          const reportFile = path.join(reportsDir, `report-${siteKey}.json`);
          if (fs.existsSync(reportFile)) {
            const reportJson = JSON.parse(fs.readFileSync(reportFile, "utf-8"));
            if (
              reportJson[page.toLowerCase()] &&
              reportJson[page.toLowerCase()][device]
            ) {
              pageUrl = reportJson[page.toLowerCase()][device].url || "";
            }
          }
        } catch {}
        if (score !== undefined && pageUrl) {
          html += `<td class="score-cell"><a href="${pageUrl}" target="_blank" rel="noopener">${getGaugeSVG(
            score
          )}</a></td>`;
        } else if (score !== undefined) {
          html += `<td class="score-cell">${getGaugeSVG(score)}</td>`;
        } else {
          html += `<td class="score-cell">N/A</td>`;
        }
      }
    }
    html += "</tr>\n";
  }
  html += `    </table>\n  </div>\n</body>\n</html>`;
  return html;
}

function main() {
  const todayDir = getTodayDir();
  const reportsDir = path.join(process.cwd(), "reports", todayDir);
  const reportFiles = getReportFiles();
  if (reportFiles.length === 0) {
    console.error("No report-*.json files found.");
    process.exit(1);
  }
  // Get the timestamp from the first report file's JSON
  const firstReportFile = reportFiles.slice().sort()[0];
  const firstReportJson = JSON.parse(fs.readFileSync(firstReportFile, "utf-8"));
  // Find the first page and device key
  const firstPage = Object.keys(firstReportJson)[0];
  const firstDevice = firstPage
    ? Object.keys(firstReportJson[firstPage])[0]
    : null;
  const timestampStr = firstDevice
    ? firstReportJson[firstPage][firstDevice].timestamp
    : null;
  if (!timestampStr) {
    console.error("No timestamp found in the first report JSON.");
    process.exit(1);
  }
  const firstReportDate = new Date(timestampStr);
  const data = parseReports(reportFiles);
  const html = generateHTMLTable(data, firstReportDate, reportsDir);
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
  fs.writeFileSync(path.join(reportsDir, "comparison.html"), html, "utf-8");
  console.log(
    `Accessibility comparison report generated at reports/${todayDir}/comparison.html`
  );
}

main();
