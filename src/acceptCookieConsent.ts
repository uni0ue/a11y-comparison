import { ElementHandle, Page } from "puppeteer";
import { setTimeout } from "node:timers/promises";

/**
 * Attempts to find and click a cookie accept button on the page.
 * Returns true if a button was found and clicked, false otherwise.
 */
export async function acceptCookieConsent(page: any): Promise<boolean> {
  try {
    await setTimeout(2000);
    // 1. Try known IDs
    const knownAcceptButtonIds = [
      "accept",
      "onetrust-accept-btn-handler",
      "uc-btn-accept-banner",
      "didomi-notice-agree-button",
      "CybotCookiebotDialogBodyLevelButtonAccept",
      "cookie-accept-all-button",
      "cookiescript_accept",
      "cookie-accept-button",
      "cookie-accept-all",
      "cmpbntyestxt",
      "cmpboxacceptall",
      "consent-accept",
      "usercentrics-accept-button",
      "privacy-accept-all",
      "cookiebanner-accept-button",
      "cookie-agree-button",
      "sp-cc-accept",
    ];
    for (const id of knownAcceptButtonIds) {
      const clicked = await page.evaluate(
        new Function(
          "btnId",
          `
        function clickButtonByIdInAllShadowRoots(id, root) {
          if (!root) root = document;
          var btn = null;
          if (root.querySelector) {
            btn = root.querySelector('button#' + id);
            if (btn) {
              btn.click();
              return true;
            }
          }
          var elements = root.querySelectorAll ? root.querySelectorAll('*') : [];
          for (var i = 0; i < elements.length; i++) {
            var el = elements[i];
            if (el.shadowRoot) {
              if (clickButtonByIdInAllShadowRoots(id, el.shadowRoot)) {
                return true;
              }
            }
          }
          return false;
        }
        return clickButtonByIdInAllShadowRoots(btnId, document);
      `
        ),
        id
      );
      if (clicked) return true;
    }
    // 2. Try button texts
    const buttonTexts = [
      "ok",
      "okay",
      "okey",
      "oké",
      "accept all",
      "accept",
      "agree",
      "allow all",
      "got it",
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
    const clickedByText = await page.evaluate(
      new Function(
        "texts",
        `
      function getAllClickableElements(root) {
      if (!root) root = document;
      var elements = [];
      if (root.querySelectorAll) {
        elements = Array.prototype.slice.call(root.querySelectorAll('button, input[type="submit"]'));
      }
      var shadowElements = root.querySelectorAll ? root.querySelectorAll('*') : [];
      for (var i = 0; i < shadowElements.length; i++) {
        var el = shadowElements[i];
        if (el.shadowRoot) {
        elements = elements.concat(getAllClickableElements(el.shadowRoot));
        }
      }
      return elements;
      }
      function normalize(text) {
      return (text || "").trim().toLowerCase();
      }
      var allElements = getAllClickableElements(document);
      for (var i = 0; i < allElements.length; i++) {
      var el = allElements[i];
      var text = normalize(el.textContent || el.value || "");
      for (var j = 0; j < texts.length; j++) {
        var kw = texts[j];
        if (text === kw || text.indexOf(kw) !== -1) {
        el.click();
        return true;
        }
      }
      }
      return false;
    `
      ),
      buttonTexts
    );
    return !!clickedByText;
  } catch (e) {
    console.error(e);
    return false;
  }
}
