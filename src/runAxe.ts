import puppeteer, { type Viewport } from "puppeteer";
import fs from "fs/promises";
import path from "path";
import { AxePuppeteer } from "@axe-core/puppeteer";
import { setTimeout } from "node:timers/promises";
import { acceptCookieConsent } from "./acceptCookieConsent";
import { scrollPageToBottom } from "puppeteer-autoscroll-down";
import { axeConfig, viewports } from "../config";
import { sites } from "../sites";
import { ignoreCountrySwitcher } from "./ignoreCountrySwitcher";

async function runAxe(
  url: string,
  viewport: keyof typeof viewports = "DESKTOP"
) {
  console.log("Starting accessibility test for " + url);
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: false,
      defaultViewport: viewports[viewport],
    });
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36"
    );

    // Always extract base domain from URL (remove www. if present)
    let domainName = new URL(url).hostname
      .replace(/^www\./, "")
      .replace(/\./g, "_");

    const cookiesPath = path.join(
      process.cwd(),
      "cookies",
      `cookies-${domainName}.json`
    );
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
            return expires <= 0 || expires > Math.floor(Date.now() / 1000);
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
        await page.setCookie(...cookies);
        cookiesLoaded = cookies.length > 0;
      } else {
        console.log("No cookies file found");
      }
    } catch (error) {
      console.error("Error loading cookies:", error);
    }

    // 2. Navigate to URL
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

    // 3. If no cookies were applied, try to accept cookie banner and save cookies
    if (!cookiesLoaded) {
      console.log(
        "No cookies loaded. Trying to find and click the accept cookie consent button..."
      );
      const accepted = await acceptCookieConsent(page);
      if (accepted) {
        // Wait for cookies to be set
        await setTimeout(2000);

        // save cookies to /cookies/cookies-[domain].json
        const allCookies = await page.cookies();
        const cookiesDir = path.dirname(cookiesPath);
        const cookiesDirExists = await fs
          .stat(cookiesDir)
          .then(() => true)
          .catch(() => false);
        if (!cookiesDirExists) {
          await fs.mkdir(cookiesDir, { recursive: true });
        }
        await fs.writeFile(cookiesPath, JSON.stringify(allCookies, null, 2));

        console.log(`Cookies saved as file for ${domainName}`);
      }
    }

    // Try to ignore the country switcher if present
    console.log("Attempting to ignore country switcher...");
    const ignored = await ignoreCountrySwitcher(page);
    if (ignored) {
      // Wait for cookies to be set
      await setTimeout(2000);
      const allCookies = await page.cookies();
      const cookiesDir = path.dirname(cookiesPath);
      const cookiesDirExists = await fs
        .stat(cookiesDir)
        .then(() => true)
        .catch(() => false);
      if (!cookiesDirExists) {
        await fs.mkdir(cookiesDir, { recursive: true });
      }
      await fs.writeFile(cookiesPath, JSON.stringify(allCookies, null, 2));
      console.log(`Cookies saved as file for ${domainName}`);
      console.log("Country switcher ignored successfully.");
    } else {
      console.log("No country switcher found.");
    }

    // Scroll down to the end of the page using puppeteer-autoscroll-down
    await scrollPageToBottom(page, {
      size: 1000,
      delay: 500,
    });
    console.log("Page loaded, running accessibility tests");

    function withTimeout(promise, ms) {
      return Promise.race([
        promise,
        new Promise((_, reject) =>
          global.setTimeout(() => reject(new Error("Timeout")), ms)
        ),
      ]);
    }

    const results = await withTimeout(
      new AxePuppeteer(page).withTags(axeConfig.tags).analyze(),
      20000 // 20 seconds timeout
    );

    // Save results to file
    console.log(`Found ${results.violations.length} accessibility violations`);
    console.log(`Found ${results.passes.length} passes`);

    return results;
  } finally {
    if (browser) await browser.close();
  }
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
(async () => {
  try {
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
            // Determine audit date from result timestamp
            const auditTimestamp = result.timestamp || new Date().toISOString();
            const auditDate = new Date(auditTimestamp);
            const yyyy = auditDate.getFullYear();
            const mm = String(auditDate.getMonth() + 1).padStart(2, "0");
            const dd = String(auditDate.getDate()).padStart(2, "0");
            const reportDir = path.join("reports", `${yyyy}-${mm}-${dd}`);
            await fs.mkdir(reportDir, { recursive: true });
            await fs.writeFile(
              path.join(reportDir, `report-${domain.replace(/\./g, "_")}.json`),
              JSON.stringify(domainResults, null, 2)
            );
            console.log(`Report written for ${domain} in ${reportDir}`);
          }
          console.log(`Finished ${viewport} ${domain} ${pageType}`);
        }
      }
    }
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
  process.exit(0);
})();
