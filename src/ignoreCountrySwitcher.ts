import { Page } from "puppeteer";
import { setTimeout } from "node:timers/promises";

/**
 * Attempts to find and click a country switcher button (e.g. 'German', 'Germany', 'Deutschland').
 * Returns true if a button was found and clicked, false otherwise.
 */
export async function ignoreCountrySwitcher(page: Page): Promise<boolean> {
  try {
    await setTimeout(1000); // Wait for dialog to appear
    const buttonTexts = [
      "german",
      "germany",
      "deutschland",
      "continue shopping",
    ];
    const buttons = await page.$$("button");
    for (const btn of buttons) {
      const textContent = await page.evaluate((el) => el.textContent, btn);
      const text = textContent ? textContent.trim().toLowerCase() : "";
      if (buttonTexts.some((kw) => text.includes(kw))) {
        await btn.click();
        return true;
      }
    }
    return false;
  } catch (e) {
    return false;
  }
}
