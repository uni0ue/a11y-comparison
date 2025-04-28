import puppeteer, { type Viewport } from "puppeteer";
import fs from "fs/promises";
import path from "path";
import { AxePuppeteer } from "@axe-core/puppeteer";
import { setTimeout } from "node:timers/promises";
import { acceptCookieConsent } from "./acceptCookieConsent";

const VIEWPORTS = {
  DESKTOP: {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    isLandscape: true,
  },
  IPHONE: {
    width: 375,
    height: 812,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    isLandscape: false,
  },
} as const satisfies Record<string, Viewport>;

async function main(
  url: string = "https://www.galaxus.de/",
  viewport: keyof typeof VIEWPORTS = "DESKTOP"
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
    defaultViewport: VIEWPORTS[viewport],
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

  // scroll down to the end of the page
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let lastPosition = 0;
      const scrollInterval = setInterval(() => {
        window.scrollBy(0, 100);
        if (lastPosition === window.scrollY) {
          clearInterval(scrollInterval);
          resolve(true);
        }
        lastPosition = window.scrollY;
        if (window.innerHeight + window.scrollY >= document.body.offsetHeight) {
          clearInterval(scrollInterval);
          resolve(true);
        }
      }, 100);
    });
  });

  console.log("Page loaded, running accessibility tests");

  // Run axe accessibility tests
  const results = await new AxePuppeteer(page).analyze();

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
}

/**
 * Open page with cookies
 * waits for 20s
 * saves cookies
 * closes browser
 */
async function manualRun(url: string) {
  console.log("Starting manual run for " + url);

  const cookiesPath = path.join(process.cwd(), "cookies.json");
  let cookies: Array<{
    name: string;
    value: string;
    domain: string;
  }> = [];

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
          return !name.startsWith("ak");
        });
    } else {
      console.log("No cookies file found");
    }
  } catch (error) {
    console.error("Error loading cookies:", error);
  }

  // Launch browser in non-headless mode
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: VIEWPORTS["DESKTOP"],
  });

  // Set cookies if they exist
  if (cookies.length > 0) {
    await browser.setCookie(...cookies);
  }

  const page = await browser.newPage();
  // Realistic Chrome user agent
  page.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36"
  );
  // Navigate to galaxus.ch
  console.log("Navigating to URL:", url);
  try {
    await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: 5000,
    });
  } catch (error) {
    await page
      .goto(url, {
        waitUntil: "networkidle2",
        timeout: 5000,
      })
      .catch((error) => {
        // ignore TimeoutErrors
        if (error.name === "TimeoutError") {
          console.log("Timeout error:", error);
        } else {
          console.error("Error navigating to URL:", error);
        }
      });
  }

  // sleep for 20s
  console.log("Sleeping for 20 seconds");
  await setTimeout(20000);
  // Save cookies for next run
  const context = page.browserContext();
  const currentCookies = await context.cookies();
  await fs.writeFile(cookiesPath, JSON.stringify(currentCookies, null, 2));
  console.log("Cookies saved");
  // Close browser
  await browser.close();
  console.log("Test completed");
}

//await manualRun("https://www.ikea.de/");
//process.exit(0);
const urls = [
  "https://www.galaxus.de/",
  // "https://www.galaxus.de/de/s1/product/apple-iphone-16-pro-256-gb-black-titanium-630-sim-esim-48-mpx-5g-smartphone-49221234",
  // "https://www.otto.de/",
  // "https://www.otto.de/p/apple-iphone-16-pro-max-smartphone-17-4-cm-6-9-zoll-1000-gb-speicherplatz-48-mp-kamera-1909231830/#variationId=1909231587",
  // "https://www.ikea.de/",
  // "https://www.ikea.com/de/de/p/bengta-1-gardinenschal-verdunk-gruen-mit-gardinenband-10602166/",
  // "https://www.amazon.de/",
  // "https://www.amazon.de/-/en/Apple-iPhone-Pro-Max-256GB/dp/B0DGHR9VG2/",
];

const existingUrls = Object.keys(
  JSON.parse(await fs.readFile("result.json", "utf-8").catch(() => "{}"))
);

for (const url of urls) {
  for (const viewport of Object.keys(VIEWPORTS) as Array<
    keyof typeof VIEWPORTS
  >) {
    if (existingUrls.includes(viewport + " " + url)) {
      console.log("Skipping " + viewport + " " + url);
      continue;
    }
    console.log("Running " + viewport + " " + url);
    await main(url, viewport).catch((error) => {
      console.error("Error running test:", error);
    });
    console.log("Finished " + viewport + " " + url);
  }
}
