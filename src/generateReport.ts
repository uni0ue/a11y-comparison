// src/generateReport.ts
// Generates a comparison HTML table of all sites/domains, their pages, and accessibility scores
import fs from "fs";
import path from "path";
import { sites } from "../sites";
import { axeConfig, viewports } from "../config";
import { importHtmlSnippet } from "./importHtmlSnippet";

// Utility to get today's date as yyyy-mm-dd
function getTodayDir() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// Find all report-*.json files in the /docs directory
function getReportFiles(reportsDir: string): string[] {
  if (!fs.existsSync(reportsDir)) return [];
  const files = fs.readdirSync(reportsDir);
  return files
    .filter((f) => f.startsWith("report-") && f.endsWith(".json"))
    .map((f) => path.join(reportsDir, f));
}

// Calculate Deque accessibility score based on https://docs.cypress.io/accessibility/core-concepts/accessibility-score
function calculateScore(deviceData: any): number {
  // Collect all unique rule IDs from passes, violations, incomplete, inapplicable
  const allRuleIds = new Set<string>();
  ["passes", "violations", "incomplete", "inapplicable"].forEach((section) => {
    if (Array.isArray(deviceData[section])) {
      for (const item of deviceData[section]) {
        if (item && item.id) allRuleIds.add(item.id);
      }
    }
  });

  // Assign weights by impact
  const impactWeight = {
    critical: 10,
    serious: 7,
    moderate: 3,
    minor: 1,
    default: 1,
  };

  // Calculate failed weights (unique rule IDs in violations, highest impact wins)
  const failedRuleWeights = new Map<string, number>();
  if (Array.isArray(deviceData.violations)) {
    for (const v of deviceData.violations) {
      if (v && v.id) {
        const weight = impactWeight[v.impact] || impactWeight.default;
        if (
          !failedRuleWeights.has(v.id) ||
          failedRuleWeights.get(v.id)! < weight
        ) {
          failedRuleWeights.set(v.id, weight);
        }
      }
    }
  }
  const failedWeight = Array.from(failedRuleWeights.values()).reduce(
    (a, b) => a + b,
    0
  );

  // Calculate passed weights (all unique rule IDs minus failed, weight by impact if available in passes/incomplete/inapplicable)
  let passedWeight = 0;
  for (const ruleId of allRuleIds) {
    if (!failedRuleWeights.has(ruleId)) {
      // Find the impact in passes/incomplete/inapplicable (if any)
      let foundImpact: string | undefined;
      for (const section of ["passes", "incomplete", "inapplicable"]) {
        if (Array.isArray(deviceData[section])) {
          const found = deviceData[section].find(
            (item: any) => item && item.id === ruleId && item.impact
          );
          if (found && found.impact) {
            foundImpact = found.impact;
            break;
          }
        }
      }
      const weight = foundImpact
        ? impactWeight[foundImpact] || impactWeight.default
        : impactWeight.default;
      passedWeight += weight;
    }
  }

  const totalWeight = passedWeight + failedWeight;
  if (totalWeight === 0) return 100.0;
  const score = (passedWeight / totalWeight) * 100;
  return Math.max(0, Math.round(score * 10) / 10);
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
    console.log("generate report for", site);
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
        // Pass the full deviceData object to calculateScore
        data[site].pages[pageKey][device] = calculateScore(deviceData);
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

  return importHtmlSnippet("score.html", {
    score: score.toFixed(0),
    color,
    circumference: circumference.toFixed(3),
    gapLength: gapLength.toFixed(2),
  });
}

function generateHTMLTable(
  data: Record<
    string,
    { pages: Record<string, Record<string, number>>; url: string }
  >,
  firstReportDate: Date,
  reportsDir: string,
  prevReportDir?: string,
  nextReportDir?: string
): string {
  const allPages = Object.keys(sites);
  const deviceKeys = Object.keys(viewports);
  const sitesInOrder = Object.keys(sites.home);

  // Format date as '28 Apr 2025 at 14:47'
  const dateStr = firstReportDate
    .toLocaleString("de-CH", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
    .replace(",", "");

  // Read lightbox HTML snippet using helper
  const lightboxHtml = importHtmlSnippet("lightbox.html");

  // --- Table Head ---
  const tableHead = `
    <tr>
      <th style="width:36px;"></th>
      <th style="text-align: left; width: 15%;">Site</th>
      ${allPages.map((page) => `<th>${page}</th>`).join("")}
    </tr>
  `;

  // --- Table Body ---
  let tableBody = "";
  for (const site of sitesInOrder) {
    const siteKey = site.replace(/\./g, "_");
    const displaySite = site;
    const siteUrl =
      data[siteKey]?.url || sites.home[site] || `https://${displaySite}`;

    const expandBtn = `<button class="expand-arrow" aria-label="Expand/collapse row"><span></span></button>`;
    tableBody += `<tr>\n<td style="width:36px; vertical-align: top; padding-top: 64px;">${expandBtn}</td><td style="vertical-align: top; padding-top: 64px;"><a class="site-link" href="${siteUrl}" target="_blank" rel="noopener"><img src="https://www.google.com/s2/favicons?domain=${site}&sz=48" alt="" style="width:20px;height:20px;vertical-align:top;margin-right:8px;object-fit:contain;">${displaySite}</a></td>`;
    for (const page of allPages) {
      tableBody += '<td class="score-cell">';
      // Begin grid container for device columns
      tableBody += `<div class="score-grid">`;
      for (const device of deviceKeys) {
        const score = data[siteKey]?.pages[page.toLowerCase()]?.[device];
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
        // Use screenshots from the 'screenshots' subfolder
        const screenshotFilename = `screenshots/${site}_${page.replace(
          / /g,
          "_"
        )}_${device.toLowerCase()}.webp`;
        const thumbFilename = `screenshots/${site}_${page.replace(
          / /g,
          "_"
        )}_${device.toLowerCase()}_thumb.jpeg`;
        const thumbPath = path.join(reportsDir, thumbFilename);
        let screenshotHtml = "";
        let summaryHtml = "";
        if (fs.existsSync(thumbPath)) {
          const relThumb = thumbFilename;
          const relScreenshot = screenshotFilename;
          screenshotHtml = `<div class=\"row-thumbnails\" hidden><a href=\"#\" class=\"screenshot-thumb\" data-full=\"${relScreenshot}\"><img src=\"${relThumb}\" alt=\"Screenshot thumbnail\" style=\"max-height:80px; max-width: 120px; border-radius:8px;box-shadow:0 2px 8px #0002;\"></a></div>`;
          // Issue summary (nested list by impact, listing rule ids)
          const impactOrder = ["critical", "serious", "moderate", "minor"];
          const impactLabels = {
            critical: "critical issue",
            serious: "serious issue",
            moderate: "moderate issue",
            minor: "minor issue",
          };
          const impactCounts = {};
          const impactRules = {};
          try {
            const reportFile = path.join(reportsDir, `report-${siteKey}.json`);
            if (fs.existsSync(reportFile)) {
              const reportJson = JSON.parse(
                fs.readFileSync(reportFile, "utf-8")
              );
              const deviceData = reportJson[page.toLowerCase()]?.[device];
              if (deviceData && Array.isArray(deviceData.violations)) {
                for (const v of deviceData.violations) {
                  if (v.impact) {
                    impactCounts[v.impact] = (impactCounts[v.impact] || 0) + 1;
                    if (!impactRules[v.impact]) impactRules[v.impact] = [];
                    impactRules[v.impact].push(v.id);
                  }
                }
              }
            }
          } catch {}
          const summaryParts = impactOrder
            .filter((impact) => impactCounts[impact])
            .map((impact) => {
              const rules = impactRules[impact] || [];
              return `<li style=\"margin-bottom: 0.4em;list-style-type:none;position:relative;\">\n                <span style=\"display:inline-block;min-width:120px;\"><strong style="display: block; margin-top: 8px;">${
                impactCounts[impact]
              } ${impactLabels[impact]}${
                impactCounts[impact] > 1 ? "s" : ""
              }</strong></span>\n                <ul style=\"margin:0.3em 0 0 0.5em;padding:0;list-style-type:disc;font-size:12px;color:#a00;position:relative;left:0.5em;\">\n                  ${rules
                .map(
                  (rule) =>
                    `<li style=\\\"margin-bottom:0.2em;font-size:13px;list-style-type:disc;\\\">${rule}</li>`
                )
                .join("")}\n                </ul>\n              </li>`;
            });
          if (summaryParts.length > 0) {
            summaryHtml = `<ul class=\"issue-summary\" style=\"font-size:13px;color:#a00;margin-top:12px;text-align:left;list-style-type:disc;display:none;\">${summaryParts.join(
              ""
            )}</ul>`;
          }
        }
        const vp = viewports[device.toUpperCase()];
        const labelText = vp
          ? `<strong>${device}</strong> <br/>(${vp.width}x${vp.height})`
          : device;
        // Responsive column: label above gauge, then screenshot, then summary (summary hidden by default)
        tableBody += `<div class=\"score-col\">\n <div class=\"score-label\">${labelText}</div>\n          <div class=\"score-gauge\">${
          score !== undefined && pageUrl
            ? `<a href=\"${pageUrl}\" target=\"_blank\" rel=\"noopener\">${getGaugeSVG(
                score
              )}</a>`
            : score !== undefined
            ? getGaugeSVG(score)
            : `<div style=\\\"color:#bbb;\\\">N/A</div>`
        }</div>\n  <div class=\"score-expander\"> <div class=\"score-expander-content\"> <div class=\"score-screenshot\">${
          screenshotHtml || ""
        }</div>\n          ${
          summaryHtml ? `<div class=\"score-summary\">${summaryHtml}</div>` : ""
        }\n        </div> </div> </div>`;
      }
      tableBody += `</div>`; // end .score-grid
      tableBody += "</td>";
    }
    tableBody += "</tr>\n";
  }

  // --- Compose Table HTML ---
  const tableHtml = importHtmlSnippet("table.html", {
    table_head: tableHead,
    table_body: tableBody,
  });

  // --- Compose Body Content ---
  const bodyContent = `
  <style>
    .score-cell {
      padding: 0;
      vertical-align: top;
    }
    .score-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
      gap: 12px;
      align-items: start;
    }
      .score-expander {
        display: grid;
        grid-template-rows: 0fr;
        overflow: hidden;
        transition: grid-template-rows 100ms ease-in-out;
      }
     tr[aria-expanded="true"] .score-expander {
      grid-template-rows: 1fr;
      } 

      .score-expander-content {
        min-height: 0;
        transition: visibility 100ms ease-in-out;
        visibility: hidden;
      }

      tr[aria-expanded="true"] .score-expander-content {
        visibility: visible;
      }

    .score-col {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 16px 8px;
      min-width: 0;
      word-break: break-word;
    }
    .score-label {
      font-size: 12px;
      margin-bottom: 8px;
      text-align: center;
      color: #485b68;
    }
    .score-gauge {
      margin-bottom: 24px;
    }
    .score-summary {
      font-size: 12px;
      margin-bottom: 8px;
      width: 100%;
    }
    .score-screenshot {
      width: 100%;
      display: flex;
      justify-content: center;
    }
    /* Show summary only when row is expanded */
    .score-summary .issue-summary {
      display: none;
    }
    tr[aria-expanded="true"] .score-summary .issue-summary {
      display: block !important;
      
    }
    @media (max-width: 600px) {
      .score-grid {
        grid-template-columns: 1fr;
      }
    }
  </style>
  <div class="container">
    <div class="audit-meta">
      Axe audit (${axeConfig.tags.join(
        ", "
      )}) <span class="timestamp">${dateStr}</span>
      <div class="nav-arrows">
        ${
          prevReportDir
            ? `<a href="../${prevReportDir}/index.html" class="nav-arrow" title="Previous Report" aria-label="Previous Report">&#8592;</a>`
            : `<span class="nav-arrow" aria-disabled="true" tabindex="-1" aria-label="Previous Report">&#8592;</span>`
        }
        ${
          nextReportDir
            ? `<a href="../${nextReportDir}/index.html" class="nav-arrow" title="Next Report" aria-label="Next Report">&#8594;</a>`
            : `<span class="nav-arrow" aria-disabled="true" tabindex="-1" aria-label="Next Report">&#8594;</span>`
        }
      </div>
    </div>
    <h1>Accessibility Comparison</h1>
    ${tableHtml}
  </div>
  ${lightboxHtml}
  <script>
    // Arrow key navigation
    document.addEventListener('keydown', function(e) {
      if (e.key === 'ArrowLeft') {
        const prev = document.querySelector('.nav-arrows a[title="Previous Report"]');
        if (prev) window.location.href = prev.href;
      }
      if (e.key === 'ArrowRight') {
        const next = document.querySelector('.nav-arrows a[title="Next Report"]');
        if (next) window.location.href = next.href;
      }
    });
    // Expand/collapse arrow rotation
    document.addEventListener('DOMContentLoaded', function() {
      document.querySelectorAll('.expand-arrow').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          btn.classList.toggle('expanded');
        });
      });
    });
  </script>
  `;

  // --- Compose Final HTML Layout ---
  const html = importHtmlSnippet("layout.html", {
    head: "",
    body: bodyContent,
  });
  return html;
}

// Export main for use in generateAllReports.ts
export function main(reportDate?: string) {
  const todayDir = reportDate || getTodayDir();
  const reportsDir = path.join(process.cwd(), "docs", todayDir);
  const reportFiles = getReportFiles(reportsDir);
  if (reportFiles.length === 0) {
    console.error("No report found for this date. Run an audit first.");
    return;
  }
  // Get the timestamp from the first report file's JSON
  const firstReportFile = reportFiles.slice().sort()[0];
  const firstReportJson = JSON.parse(fs.readFileSync(firstReportFile, "utf-8"));
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

  // Generate/update docs/index.html with list of report links
  const docsRoot = path.join(process.cwd(), "docs");
  const reportDirs = fs
    .readdirSync(docsRoot)
    .filter(
      (f) =>
        /^\d{4}-\d{2}-\d{2}$/.test(f) &&
        fs.statSync(path.join(docsRoot, f)).isDirectory()
    )
    .sort()
    .reverse(); // Newest first

  // Find the current report's index in the sorted list
  const currentIndex = reportDirs.indexOf(todayDir);
  // Previous report is the next index (older), next report is previous index (newer)
  const prevReportDir =
    currentIndex >= 0 && currentIndex + 1 < reportDirs.length
      ? reportDirs[currentIndex + 1]
      : undefined;
  const nextReportDir =
    currentIndex > 0 ? reportDirs[currentIndex - 1] : undefined;

  const html = generateHTMLTable(
    data,
    firstReportDate,
    reportsDir,
    prevReportDir,
    nextReportDir
  );
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
  fs.writeFileSync(path.join(reportsDir, "index.html"), html, "utf-8");
  fs.writeFileSync(path.join(docsRoot, "index.html"), html, "utf-8");
  console.log(
    `Accessibility comparison report generated at docs/${todayDir}/index.html and docs/index.html`
  );

  const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Accessibility Reports Index</title>
  <style>
    body { font-family: sans-serif; padding: 2rem; background: #f9f9f9; }
    h1 { font-size: 1.8rem; }
    ul { list-style: none; padding: 0; }
    li { margin: 0.5rem 0; }
    a { text-decoration: none; color: #007acc; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>Accessibility Report History</h1>
  <ul>
    ${reportDirs
      .map((dir) => `<li><a href="./${dir}/index.html">${dir}</a></li>`)
      .join("\n")}
  </ul>
</body>
</html>
`;

  fs.writeFileSync(path.join(docsRoot, "index.html"), indexHtml, "utf-8");
}

// If run directly, call main() for today
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
