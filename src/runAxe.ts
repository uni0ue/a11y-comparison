import puppeteer, { type Viewport, type Browser } from "puppeteer";
import fs from "fs/promises";
import path from "path";
import { AxePuppeteer } from "@axe-core/puppeteer";
import { setTimeout } from "node:timers/promises";
import { acceptCookieConsent } from "./acceptCookieConsent";
import { scrollPageToBottom, scrollPageToTop } from "puppeteer-autoscroll-down";
import { axeConfig, viewports } from "../config";
import { sites } from "../sites";
import { ignoreCountrySwitcher } from "./ignoreCountrySwitcher";
import { KnownDevices } from "puppeteer";
import { Jimp } from "jimp";

async function runAxe(
  url: string,
  viewport: keyof typeof viewports = "DESKTOP",
  domain?: string,
  pageType?: string
) {
  console.log("Starting accessibility test for " + url);
  let browser: Browser | null = null;
  let screenshotPath: string | null = null;
  try {
    // Use CHROME_BIN or PUPPETEER_EXECUTABLE_PATH if set (for CI environments like browser-actions/setup-chrome)
    const executablePath =
      process.env.PUPPETEER_EXECUTABLE_PATH ||
      process.env.CHROME_BIN ||
      undefined;

    browser = await puppeteer.launch({
      headless: true,
      executablePath,
      defaultViewport: viewports[viewport],
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    console.log(
      "Puppeteer executablePath:",
      executablePath || puppeteer.executablePath()
    );
    const page = await browser.newPage();
    const puppeteerDevices = KnownDevices;

    if (viewport.toUpperCase() === "MOBILE") {
      // Emulate iPhone 16 Pro for mobile
      const device = puppeteerDevices["iPhone 16 Pro"];
      if (device) {
        await page.emulate(device);
        console.log("Emulating:", device.name);
      } else {
        // fallback: set viewport and user agent
        await page.setViewport(viewports[viewport]);
        await page.setUserAgent(
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
        );
        console.log("Emulating fallback mobile viewport");
      }
    } else {
      // Desktop: set viewport and user agent as before
      await page.setViewport(viewports[viewport]);
      await page.setUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36"
      );
    }

    // Always extract base domain from URL (remove www. if present)
    let domainName =
      domain || new URL(url).hostname.replace(/^www\./, "").replace(/\./g, "_");
    let pageTypeName = pageType || "unknown";

    const cookiesPath = path.join(
      process.cwd(),
      "storage",
      `cookies-${domainName}.json`
    );
    const localStoragePath = path.join(
      process.cwd(),
      "storage",
      `localstorage-${domainName}.json`
    );
    let cookiesLoaded = false;
    let localStorageLoaded = false;
    // Restore cookies before navigation
    try {
      const cookiesExists = await fs
        .stat(cookiesPath)
        .then(() => true)
        .catch(() => false);
      if (cookiesExists) {
        console.log("Loading cookies from file");
        const cookiesData = await fs.readFile(cookiesPath, "utf-8");
        const cookies = JSON.parse(cookiesData)
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
          })
          .filter((cookie) => {
            // Filter out cookies with invalid or empty names
            if (!cookie.name || typeof cookie.name !== "string") {
              console.warn("Invalid cookie detected and removed:", cookie);
              return false;
            }
            return true;
          })
          .map((cookie) => {
            // Decode cookie values
            if (cookie.value && typeof cookie.value === "string") {
              try {
                cookie.value = decodeURIComponent(cookie.value);
              } catch (e) {
                console.warn("Error decoding cookie value:", e);
              }
            }
            return cookie;
          });
        await page.setCookie(...cookies);
        cookiesLoaded = cookies.length > 0;
      } else {
        console.log("No cookies file found");
      }
    } catch (error) {
      console.error("Error loading cookies:", error);
    }
    // Restore localStorage before navigation (use evaluateOnNewDocument)
    try {
      const localStorageExists = await fs
        .stat(localStoragePath)
        .then(() => true)
        .catch(() => false);
      if (localStorageExists) {
        const localStorageData = await fs.readFile(localStoragePath, "utf-8");
        const localStorageObj = JSON.parse(localStorageData);
        await page.evaluateOnNewDocument((data) => {
          for (const key in data) {
            window.localStorage.setItem(key, data[key]);
          }
        }, localStorageObj);
        localStorageLoaded = Object.keys(localStorageObj).length > 0;
        console.log("Restored localStorage for domain " + domainName);
      }
    } catch (error) {
      console.error("Error restoring localStorage:", error);
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
    if (!cookiesLoaded && !localStorageLoaded) {
      console.log(
        "No cookies/localStorage loaded. Trying to find and click the accept cookie consent button..."
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
        // --- Save localStorage after consent ---
        const localStorageObj = await page.evaluate(() => {
          const out = {};
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key !== null) {
              out[key] = localStorage.getItem(key);
            }
          }
          return out;
        });
        await fs.writeFile(
          localStoragePath,
          JSON.stringify(localStorageObj, null, 2)
        );
        console.log(`localStorage saved as file for ${domainName}`);
        // --- End localStorage save ---
      }
    }

    // Try to ignore the country switcher if present
    console.log("Attempting to ignore country switcher...");
    const ignored = await ignoreCountrySwitcher(page);
    if (ignored) {
      // Wait for cookies to be set
      await setTimeout(2000);
      // Save cookies
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
      // Save localStorage
      const localStorageObj = await page.evaluate(() => {
        const out = {};
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          out[key] = localStorage.getItem(key);
        }
        return out;
      });
      await fs.writeFile(
        localStoragePath,
        JSON.stringify(localStorageObj, null, 2)
      );
      console.log(`localStorage saved as file for ${domainName}`);
      console.log("Country switcher ignored successfully.");
    } else {
      console.log("No country switcher found.");
    }

    // Scroll down to the end of the page using puppeteer-autoscroll-down
    await scrollPageToBottom(page, {
      size: 1000,
      delay: 500,
    });
    await scrollPageToTop(page, {
      size: 10000,
      delay: 500,
    });
    await setTimeout(2000);
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

    // Use timestamp from results or now
    const auditTimestamp = results.timestamp || new Date().toISOString();
    const auditDate = new Date(auditTimestamp);
    const yyyy = auditDate.getFullYear();
    const mm = String(auditDate.getMonth() + 1).padStart(2, "0");
    const dd = String(auditDate.getDate()).padStart(2, "0");
    const reportDir = path.join("docs", `${yyyy}-${mm}-${dd}`);
    await fs.mkdir(reportDir, { recursive: true });
    // Screenshot filename: [domain]_[pageType]_[viewport].png
    const safePageTypeName = pageTypeName.replace(/\s+/g, "_");
    // Ensure screenshots are stored in a subfolder "screenshots"
    const screenshotsDir = path.join(reportDir, "screenshots");
    await fs.mkdir(screenshotsDir, { recursive: true });
    const screenshotFilename = `${domainName}_${safePageTypeName}_${viewport.toLowerCase()}.webp`;
    screenshotPath = path.join(screenshotsDir, screenshotFilename);
    await page.screenshot({
      path: screenshotPath,
      fullPage: true,
      type: "jpeg",
    });

    console.log(`Screenshot saved: ${screenshotPath}`);
    // Save viewport-sized screenshot for thumbnail
    const thumbFilename =
      `${domainName}_${safePageTypeName}_${viewport.toLowerCase()}_thumb.jpeg` as const;
    const thumbPath = path.join(
      screenshotsDir,
      thumbFilename
    ) as `${string}.jpeg`;
    await page.screenshot({ path: thumbPath, fullPage: false, type: "jpeg" });

    const image = await Jimp.read(thumbPath);
    await image
      .resize({ w: 160 }) // Resize to 160x120
      .write(thumbPath); // Save the image
    console.log(`Thumbnail screenshot saved: ${thumbPath}`);
    // --- End screenshot logic ---

    return { ...results, screenshotPath, timestamp: auditTimestamp };
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
          const result = await runAxe(url, viewport, domain, pageType).catch(
            (error) => {
              console.error("Error running test:", error);
              return null;
            }
          );
          if (result) {
            if (!domainResults[pageType]) domainResults[pageType] = {};
            domainResults[pageType][viewport] = result;
            // Determine audit date from result timestamp
            const auditTimestamp = result.timestamp || new Date().toISOString();
            const auditDate = new Date(auditTimestamp);
            const yyyy = auditDate.getFullYear();
            const mm = String(auditDate.getMonth() + 1).padStart(2, "0");
            const dd = String(auditDate.getDate()).padStart(2, "0");
            const reportDir = path.join("docs", `${yyyy}-${mm}-${dd}`);
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
})();
