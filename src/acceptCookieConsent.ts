import { ElementHandle, Page } from "puppeteer";
import { setTimeout } from "node:timers/promises";

/**
 * Helper to recursively find a button by ID or text in all shadow roots and the main DOM
 */
async function findButtonInAllShadowRoots(
  page: Page,
  options: { id?: string; texts?: string[] }
) {
  return await page.evaluateHandle(function (opts) {
    function normalize(text) {
      return (text || "").trim().toLowerCase();
    }
    function matches(text, texts) {
      return (
        texts &&
        texts.some(function (kw) {
          return text.includes(kw);
        })
      );
    }
    function findInNode(node) {
      if (!node) return null;
      // By ID
      if (opts.id) {
        var btn = node.querySelector && node.querySelector("button#" + opts.id);
        if (btn) return btn;
      }
      // By text
      if (opts.texts) {
        var buttons = node.querySelectorAll && node.querySelectorAll("button");
        if (buttons) {
          for (var i = 0; i < buttons.length; i++) {
            var text = normalize(buttons[i].textContent);
            if (matches(text, opts.texts)) return buttons[i];
          }
        }
      }
      // Recurse into shadow roots
      var treeWalker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT);
      var currentNode = treeWalker.currentNode;
      while (currentNode) {
        if (currentNode.shadowRoot) {
          var found = findInNode(currentNode.shadowRoot);
          if (found) return found;
        }
        var nextNode = treeWalker.nextNode();
        if (!nextNode) break;
        currentNode = nextNode;
      }
      return null;
    }
    return findInNode(document);
  }, options);
}

/**
 * Attempts to find and click a cookie accept button on the page.
 * Returns true if a button was found and clicked, false otherwise.
 */
export async function acceptCookieConsent(page: Page): Promise<boolean> {
  try {
    await setTimeout(2000);
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
    // 1. Try by known IDs in all DOMs
    for (const id of knownAcceptButtonIds) {
      const elHandle = await findButtonInAllShadowRoots(page, { id });
      if (elHandle && (await elHandle.evaluate((el) => !!el))) {
        await elHandle.click();
        return true;
      }
    }
    // 2. Try by button text in all DOMs
    const buttonTexts = [
      "accept all",
      "accept",
      "agree",
      "allow all",
      "got it",
      "ok",
      "okay",
      "okey",
      "oké",
      "zulassen",
      "akzeptieren",
      "verstanden",
      "zustimmen",
      "i agree",
      "accept cookies",
      "accept all cookies",
      "j'accepte",
      "accepter",
      "alle zulassen",
    ];
    const elHandle = await findButtonInAllShadowRoots(page, {
      texts: buttonTexts,
    });
    if (elHandle && (await elHandle.evaluate((el) => !!el))) {
      await elHandle.click();
      return true;
    }
    return false;
  } catch (e) {
    console.error(e);
    return false;
  }
}
