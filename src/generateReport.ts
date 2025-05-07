// src/generateReport.ts
// Generates a comparison HTML table of all sites/domains, their pages, and accessibility scores
import fs from "fs";
import path from "path";
import { sites } from "../sites";
import { viewports } from "../config";
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
      <th style="text-align: left;">Site</th>
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
    tableBody += `<tr>\n<td><a class="site-link" href="${siteUrl}" target="_blank" rel="noopener"><img src="https://www.google.com/s2/favicons?domain=${site}&sz=48" alt="" style="width:20px;height:20px;vertical-align:middle;margin-right:8px;object-fit:contain;">${displaySite}</a></td>`;
    for (const page of allPages) {
      tableBody += '<td class="score-cell">';
      let first = true;
      for (const device of deviceKeys) {
        if (!first) {
          tableBody +=
            '<div style="height:1px;width:100%;background:#e0e0e0;margin:24px 0 24px 0;"></div>';
        }
        first = false;
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
        const screenshotFilename = `${site}_${page.replace(
          / /g,
          "_"
        )}_${device.toLowerCase()}.webp`;
        const thumbFilename = `${site}_${page.replace(
          / /g,
          "_"
        )}_${device.toLowerCase()}_thumb.jpeg`;
        const thumbPath = path.join(reportsDir, thumbFilename);
        let screenshotHtml = "";
        if (fs.existsSync(thumbPath)) {
          const relThumb = thumbFilename;
          const relScreenshot = screenshotFilename;
          screenshotHtml = `<div style="margin-top:6px;"><a href="#" class="screenshot-thumb" data-full="${relScreenshot}"><img src="${relThumb}" alt="Screenshot thumbnail" style="max-height:80px; max-width: 120px; border-radius:8px;box-shadow:0 2px 8px #0002;"></a></div>`;
        }
        const vp = viewports[device.toUpperCase()];
        const labelText = vp
          ? `<strong>${device}</strong> <br/>(${vp.width}x${vp.height})`
          : device;
        const label = `<div style="font-size:11px;color:#888;margin:16px 0 16px 0;">${labelText}</div>`;
        if (score !== undefined && pageUrl) {
          tableBody += `<div style="display:block;vertical-align:top;text-align:center;width:130px;max-width:100%;margin:0 auto;">`;
          tableBody += `<a href="${pageUrl}" target="_blank" rel="noopener">${getGaugeSVG(
            score
          )}</a>${label}${screenshotHtml}`;
          tableBody += `</div>`;
        } else if (score !== undefined) {
          tableBody += `<div style="display:block;vertical-align:top;text-align:center;width:130px;max-width:100%;margin:0 auto;">`;
          tableBody += `${getGaugeSVG(score)}${label}${screenshotHtml}`;
          tableBody += `</div>`;
        } else {
          tableBody += `<div style="display:block;vertical-align:top;text-align:center;width:130px;max-width:100%;color:#bbb;margin:0 auto;">N/A</div>`;
        }
      }
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
  <div class="container">
    <div class="audit-meta">
      Axe audit (EN-301-549) <span class="timestamp">${dateStr}</span>
      <div class="nav-arrows">
        <a href="../${prevReportDir}/index.html" class="nav-arrow" title="Previous Report" aria-label="Previous Report">&#8592;</a>
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
  </script>
  `;

  // --- Compose Final HTML Layout ---
  const html = importHtmlSnippet("layout.html", {
    head: "",
    body: bodyContent,
  });
  return html;
}

function main() {
  const todayDir = getTodayDir();
  const reportsDir = path.join(process.cwd(), "docs", todayDir);
  const reportFiles = getReportFiles(reportsDir);
  if (reportFiles.length === 0) {
    console.error("No report-*.json files found.");
    process.exit(1);
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
    .reverse();

  const currentIndex = reportDirs.indexOf(todayDir);
  const prevReportDir = reportDirs[currentIndex + 1];
  const nextReportDir = reportDirs[currentIndex - 1];

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

main();
