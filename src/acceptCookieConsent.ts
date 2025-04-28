import { Page } from "puppeteer";
import { setTimeout } from "node:timers/promises";

/**
 * Attempts to find and click a cookie accept button on the page.
 * Returns true if a button was found and clicked, false otherwise.
 */
export async function acceptCookieConsent(page: Page): Promise<boolean> {
  try {
    // Wait a short time for banners to appear
    await setTimeout(2000);
    return await page.evaluate(() => {
      const knownAcceptButtonIds = [
        "pwa-consent-layer-accept-all-button",
        "onetrust-accept-btn-handler",
        "didomi-notice-agree-button",
        "cookie-accept-all-button",
        "cookie-accept-button",
        "cookie-accept-all",
        "cookie-accept",
        "sp-cc-accept",
        "accept",
      ];
      const shortKeywords = ["ok", "okay", "okey", "oké"];
      const longKeywords = [
        "zulassen",
        "akzeptieren",
        "verstanden",
        "zustimmen",
        "accept",
        "accept all",
        "i agree",
        "allow all",
        "agree",
        "got it",
        "accept cookies",
        "accept all cookies",
        "j'accepte",
        "accepter",
        "alle zulassen",
      ];
      function normalize(text: string) {
        return (text || "").replace(/\s+/g, " ").trim().toLowerCase();
      }
      function matchesKeyword(text: string) {
        for (const kw of shortKeywords) {
          const re = new RegExp(`\\b${kw}\\b`, "i");
          if (re.test(text)) return true;
        }
        for (const kw of longKeywords) {
          if (text.includes(kw)) return true;
        }
        return false;
      }
      function deepQuerySelectorAll(
        node: any,
        selector: string
      ): HTMLElement[] {
        let results: HTMLElement[] = [];
        if (!node) return results;
        if (node.shadowRoot) {
          results.push(...deepQuerySelectorAll(node.shadowRoot, selector));
        }
        if (node.querySelectorAll) {
          results.push(...Array.from(node.querySelectorAll(selector)));
        }
        for (const child of node.children || []) {
          results.push(...deepQuerySelectorAll(child, selector));
        }
        return results;
      }
      // Try known IDs
      for (const id of knownAcceptButtonIds) {
        let el = document.getElementById(id);
        if (!el) {
          const matches = deepQuerySelectorAll(document.body, `#${id}`);
          if (matches.length > 0) el = matches[0];
        }
        if (el) {
          (el as HTMLElement).click();
          return true;
        }
      }
      // Try testid attribute
      const testidSelectors = ['[testid="uc-accept-all-button"]'];
      for (const sel of testidSelectors) {
        const matches = deepQuerySelectorAll(document.body, sel);
        if (matches.length > 0) {
          (matches[0] as HTMLElement).click();
          return true;
        }
      }
      // Try by text content
      const selectors = [
        "button",
        "input[type='button']",
        "input[type='submit']",
        "a",
        '[role="button"]',
      ];
      for (const sel of selectors) {
        const matches = deepQuerySelectorAll(document.body, sel);
        for (const el of matches) {
          const text = normalize(el.textContent || (el as any).value || "");
          if (matchesKeyword(text)) {
            (el as HTMLElement).click();
            return true;
          }
        }
      }
      return false;
    });
  } catch (e) {
    return false;
  }
}
