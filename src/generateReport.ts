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

// Get historical data for all sites across all available report dates
// Cache the historical data to avoid re-parsing all files every time
function getHistoricalData(
  skipCache: boolean = false
): Record<string, Array<{ date: string; score: number }>> {
  const cacheFile = path.join(process.cwd(), ".cache", "historical-data.json");
  const now = Date.now();

  // Try to load cache from disk if not skipping cache
  if (!skipCache && fs.existsSync(cacheFile)) {
    try {
      const cacheData = JSON.parse(fs.readFileSync(cacheFile, "utf-8"));
      const cacheAge = now - cacheData.timestamp;

      // Use cache if less than 60 seconds old
      if (cacheAge < 60000) {
        console.log(
          `📋 Using cached historical data (${Math.round(
            cacheAge / 1000
          )}s old)`
        );
        return cacheData.data;
      }
    } catch (error) {
      console.log("⚠️ Cache file corrupted, rebuilding...");
    }
  }

  console.log("📊 Building historical data cache...");
  const startTime = Date.now();

  const docsRoot = path.join(process.cwd(), "docs");
  const reportDirs = fs
    .readdirSync(docsRoot)
    .filter(
      (f) =>
        /^\d{4}-\d{2}-\d{2}$/.test(f) &&
        fs.statSync(path.join(docsRoot, f)).isDirectory()
    )
    .sort(); // Chronological order (oldest first)

  const historicalData: Record<
    string,
    Array<{ date: string; score: number }>
  > = {};

  for (const reportDir of reportDirs) {
    const reportsDir = path.join(docsRoot, reportDir);
    const reportFiles = getReportFiles(reportsDir);

    if (reportFiles.length === 0) continue;

    const data = parseReports(reportFiles);

    // Calculate average score for each site
    for (const [siteKey, siteData] of Object.entries(data)) {
      if (!historicalData[siteKey]) {
        historicalData[siteKey] = [];
      }

      // Calculate average across all pages and devices
      let totalScore = 0;
      let scoreCount = 0;

      for (const pageData of Object.values(siteData.pages)) {
        for (const deviceScore of Object.values(pageData)) {
          if (typeof deviceScore === "number") {
            totalScore += deviceScore;
            scoreCount++;
          }
        }
      }

      if (scoreCount > 0) {
        const averageScore = totalScore / scoreCount;
        historicalData[siteKey].push({
          date: reportDir,
          score: Math.round(averageScore * 10) / 10,
        });
      }
    }
  }

  // Cache the result to disk
  const cacheData = {
    timestamp: now,
    data: historicalData,
  };

  // Ensure cache directory exists
  const cacheDir = path.dirname(cacheFile);
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  try {
    fs.writeFileSync(cacheFile, JSON.stringify(cacheData), "utf-8");
  } catch (error) {
    console.log("⚠️ Failed to save cache:", error);
  }

  const endTime = Date.now();
  console.log(`✅ Historical data cached in ${endTime - startTime}ms`);

  return historicalData;
}

// Generate SVG line chart for historical scores
function generateHistoryChart(
  siteKey: string,
  historicalData: Record<string, Array<{ date: string; score: number }>>
): string {
  const data = historicalData[siteKey] || [];

  if (data.length < 2) {
    return `<div style="color: #999; font-size: 12px; text-align: center; padding: 20px;">No history</div>`;
  }

  const chartWidth = 200;
  const chartHeight = 100;
  const padding = 8;
  const width = chartWidth + 2 * padding;
  const height = chartHeight + 2 * padding;

  // Y-axis is always 0-100 (Lighthouse score range)
  const minY = 0;
  const maxY = 100;

  // X-axis based on data points
  const minX = 0;
  const maxX = data.length - 1;

  // Convert data points to SVG coordinates
  const points = data.map((point, index) => {
    const x = padding + (index / maxX) * chartWidth;
    const y =
      padding +
      chartHeight -
      ((point.score - minY) / (maxY - minY)) * chartHeight;
    return { x, y, ...point };
  });

  // Lighthouse threshold lines
  const thresholds = [
    { score: 50, color: "#ff4136", label: "Poor/Needs Improvement" },
    { score: 90, color: "#ffa400", label: "Needs Improvement/Good" },
  ];

  const thresholdLines = thresholds
    .map((threshold) => {
      const y =
        padding +
        chartHeight -
        ((threshold.score - minY) / (maxY - minY)) * chartHeight;
      return `<line x1="${padding}" y1="${y}" x2="${
        padding + chartWidth
      }" y2="${y}" stroke="${
        threshold.color
      }" stroke-width="0.5" stroke-opacity="0.3" stroke-dasharray="2,2"/>`;
    })
    .join("");

  // Color zones (background rectangles)
  const zones = [
    { start: 0, end: 50, color: "#ff4136", opacity: 0.15 }, // Poor (red)
    { start: 50, end: 90, color: "#ffa400", opacity: 0.15 }, // Needs Improvement (orange)
    { start: 90, end: 100, color: "#0cce6b", opacity: 0.15 }, // Good (green)
  ];

  const zoneRects = zones
    .map((zone) => {
      const y1 =
        padding +
        chartHeight -
        ((zone.end - minY) / (maxY - minY)) * chartHeight;
      const y2 =
        padding +
        chartHeight -
        ((zone.start - minY) / (maxY - minY)) * chartHeight;
      return `<rect x="${padding}" y="${y1}" width="${chartWidth}" height="${
        y2 - y1
      }" fill="${zone.color}" fill-opacity="${zone.opacity}"/>`;
    })
    .join("");

  // Function to get color based on score
  const getScoreColor = (score: number) => {
    if (score >= 90) return "#0cce6b"; // green
    if (score < 50) return "#ff4136"; // red
    return "#ffa400"; // orange
  };

  // Create line segments with different colors
  const lineSegments = points
    .slice(1)
    .map((point, index) => {
      const prevPoint = points[index];
      const segmentColor = getScoreColor(point.score);
      return `<line x1="${prevPoint.x}" y1="${prevPoint.y}" x2="${point.x}" y2="${point.y}" stroke="${segmentColor}" stroke-width="2"/>`;
    })
    .join("");

  // Generate dots for each data point with individual colors based on score
  const dots = points
    .map((point) => {
      const dotColor = getScoreColor(point.score);
      return `<circle cx="${point.x}" cy="${point.y}" r="3" fill="${dotColor}" stroke="white" stroke-width="1"/>`;
    })
    .join("");

  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="border-radius: 4px;">
      ${zoneRects}
      ${thresholdLines}
      ${lineSegments}
      ${dots}
      <title>Score history: ${data
        .map((d) => `${d.date}: ${d.score}`)
        .join(", ")}</title>
    </svg>
  `;
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

  // Get historical data for charts
  const historicalData = getHistoricalData();

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
    <tr style="background-color: #fff; position: sticky; top: 0; box-shadow: 0px 2px 9px rgb(144 156 165 / 20%); z-index: 1;">
      <th style="width:36px;"></th>
      <th style="text-align: left; width: 12%;">Site</th>
      ${allPages
        .map((page) => `<th style="min-width: 400px;">${page}</th>`)
        .join("")}
      <th style="width: 220px;">History</th>
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

    // Add history chart column
    tableBody += `<td class="history-cell" style="padding: 16px; vertical-align: top;">`;
    tableBody += generateHistoryChart(siteKey, historicalData);
    tableBody += "</td>";

    tableBody += "</tr>\n";
  }

  // --- Compose Table HTML ---
  const tableHtml = importHtmlSnippet("table.html", {
    table_head: tableHead,
    table_body: tableBody,
  });

  // --- Compose Body Content ---
  const bodyContent = `
  <div class="container">
  <header>
  <h1>Accessibility Comparison</h1>
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
    </header>
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
export function main(reportDate?: string, latestOnly: boolean = false) {
  let todayDir: string;

  if (latestOnly) {
    // Find the most recent report directory
    const docsRoot = path.join(process.cwd(), "docs");
    if (!fs.existsSync(docsRoot)) {
      console.error(
        "No docs directory found. Run an audit first with 'npm run axe'."
      );
      return;
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
      return;
    }

    todayDir = reportDirs[reportDirs.length - 1]; // Get the latest
    console.log(`🚀 Latest report mode: Using ${todayDir}`);
  } else {
    todayDir = reportDate || getTodayDir();
  }

  const reportsDir = path.join(process.cwd(), "docs", todayDir);
  const reportFiles = getReportFiles(reportsDir);
  if (reportFiles.length === 0) {
    console.error(`No report found for ${todayDir}. Run an audit first.`);
    return;
  }

  console.log(`📈 Generating report for ${todayDir}...`);
  const startTime = Date.now();

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

  const docsRoot = path.join(process.cwd(), "docs");
  let prevReportDir, nextReportDir, reportDirs;

  if (latestOnly) {
    // For latest-only mode, skip navigation and directory scanning for faster execution
    prevReportDir = undefined;
    nextReportDir = undefined;
    reportDirs = [];
    console.log(
      "🚀 Latest-only mode: Skipping navigation and index generation for faster execution"
    );
  } else {
    // Generate/update docs/index.html with list of report links
    reportDirs = fs
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
    prevReportDir =
      currentIndex >= 0 && currentIndex + 1 < reportDirs.length
        ? reportDirs[currentIndex + 1]
        : undefined;
    nextReportDir = currentIndex > 0 ? reportDirs[currentIndex - 1] : undefined;
  }

  const html = generateHTMLTable(
    data,
    firstReportDate,
    reportsDir,
    prevReportDir,
    nextReportDir
  );
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
  fs.writeFileSync(path.join(reportsDir, "index.html"), html, "utf-8");

  if (!latestOnly) {
    // Only update docs root index and previous reports when not in today-only mode
    fs.writeFileSync(path.join(docsRoot, "index.html"), html, "utf-8");

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

  console.log(
    `Accessibility comparison report generated at docs/${todayDir}/index.html${
      !latestOnly ? " and docs/index.html" : ""
    }`
  );

  if (!latestOnly && !reportDate && prevReportDir) {
    // Update previous report so its forward navigation points to this one
    main(prevReportDir);
  }
}

// If run directly, call main() for today
if (import.meta.url === `file://${process.argv[1]}`) {
  const latestOnly = process.argv.includes("--latest");
  if (latestOnly) {
    console.log("🏃‍♂️ Running in latest-only mode for faster execution");
  }
  main(undefined, latestOnly);
}
