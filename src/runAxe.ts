import puppeteer, { type Viewport } from "puppeteer";
import fs from "fs/promises";
import path from "path";
import { AxePuppeteer } from "@axe-core/puppeteer";
import { setTimeout } from "node:timers/promises";
import { acceptCookieConsent } from "./acceptCookieConsent";
import { scrollPageToBottom } from "puppeteer-autoscroll-down";
import { axeConfig, viewports } from "./config";
import { sites } from "./sites";

async function runAxe(
  url: string = "https://www.galaxus.de/",
  viewport: keyof typeof viewports = "DESKTOP"
) {
  console.log("Starting accessibility test for " + url);

  const cookiesPath = path.join(process.cwd(), "cookies.json");
  let cookies: Array<{
    name: string;
    value: string;
    domain: string;
  }> = [];
  let cookiesLoaded = false;

  // Check if cookies file exists and load it
  try {
    const cookiesExists = await fs
      .stat(cookiesPath)
      .then(() => true)
      .catch(() => false);
    if (cookiesExists) {
      console.log("Loading cookies from file");
      const cookiesData = await fs.readFile(cookiesPath, "utf-8");
      cookies = JSON.parse(cookiesData)
        // Filter out invalid cookies
        .filter((cookie) => cookie.name && cookie.value)
        // Filter out expired cookies
        .filter((cookie) => {
          const expires = cookie.expires || 0;
          return expires === 0 || expires > Math.floor(Date.now() / 1000);
        })
        // remove ak*
        .filter((cookie) => {
          const name = cookie.name || "";
          return (
            !name.startsWith("ak") &&
            name !== "_abck" &&
            name !== "bm_sv" &&
            !["_uetsid", "_uetvid"].includes(name)
          );
        });
      cookiesLoaded = cookies.length > 0;
    } else {
      console.log("No cookies file found");
    }
  } catch (error) {
    console.error("Error loading cookies:", error);
  }

  // Launch browser in non-headless mode
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: viewports[viewport],
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36"
  );

  // Set cookies if they exist
  if (cookiesLoaded) {
    await page.setCookie(...cookies);
  }

  // Navigate to URL
  console.log("Navigating to URL:", url);
  await page
    .goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 5000,
    })
    .catch((error) => {
      if (error.name === "TimeoutError") {
        console.log("Timeout error:", error);
      } else {
        console.error("Error navigating to URL:", error);
      }
    });

  // Accept cookie banner if cookies not loaded
  if (!cookiesLoaded) {
    const accepted = await acceptCookieConsent(page);
    if (accepted) {
      // Wait for cookies to be set
      await setTimeout(2000);
      const context = page.browserContext();
      const currentCookies = await context.cookies();
      await fs.writeFile(cookiesPath, JSON.stringify(currentCookies, null, 2));
      console.log("Cookies accepted and saved");
    } else {
      console.log("No cookie banner accepted or not found");
    }
  }

  // Scroll down to the end of the page using puppeteer-autoscroll-down
  await scrollPageToBottom(page, {
    size: 500,
    delay: 500,
  });
  console.log("Page loaded, running accessibility tests");

  // Run axe accessibility tests for EN-301-549 only (from config)
  const results = await new AxePuppeteer(page)
    .withTags(axeConfig.tags)
    .analyze();

  // Save results to file
  console.log(`Found ${results.violations.length} accessibility violations`);
  console.log(`Found ${results.passes.length} passes`);

  let allResults = {};
  try {
    const previousResultsData = await fs.readFile("result.json", "utf-8");
    allResults = JSON.parse(previousResultsData);
  } catch (error) {
    console.error("Error reading previous results:", error);
  }

  await fs.writeFile(
    "result.json",
    JSON.stringify({ ...allResults, [viewport + " " + url]: results }, null, 2)
  );

  console.log("Results saved to result.json");

  // Close browser
  await browser.close();
  console.log("Test completed");

  return results;
}

// Helper to extract all domains from the sites config
function getAllDomains(sitesConfig: typeof sites): string[] {
  const domains = new Set<string>();
  for (const pageType of Object.keys(sitesConfig)) {
    for (const domain of Object.keys(sitesConfig[pageType])) {
      domains.add(domain);
    }
  }
  return Array.from(domains);
}

// Helper to get all page types
function getAllPageTypes(sitesConfig: typeof sites): string[] {
  return Object.keys(sitesConfig);
}

// Main loop: iterate by domain, then by page type for that domain
const allDomains = getAllDomains(sites);
const allPageTypes = getAllPageTypes(sites);

for (const domain of allDomains) {
  const domainResults: Record<string, any> = {};
  for (const pageType of allPageTypes) {
    const url = sites[pageType][domain];
    if (!url) continue;
    for (const viewport of Object.keys(viewports) as Array<
      keyof typeof viewports
    >) {
      console.log(`Running ${viewport} ${domain} ${pageType} ${url}`);
      const result = await runAxe(url, viewport).catch((error) => {
        console.error("Error running test:", error);
        return null;
      });
      if (result) {
        if (!domainResults[pageType]) domainResults[pageType] = {};
        domainResults[pageType][viewport] = result;
      }
      console.log(`Finished ${viewport} ${domain} ${pageType}`);
    }
  }
  // Write a report per domain
  await fs.writeFile(
    `report-${domain.replace(/\./g, "_")}.json`,
    JSON.stringify(domainResults, null, 2)
  );
  console.log(`Report written for ${domain}`);
}
