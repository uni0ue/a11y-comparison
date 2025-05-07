import fs from "fs";
import path from "path";

/**
 * Loads an HTML snippet from the templates directory and replaces placeholders.
 * @param filename The name of the HTML file (e.g., "lightbox.html")
 * @param params Optional object with placeholder values (e.g., { score: 95 })
 * @returns The HTML content as a string
 */
export function importHtmlSnippet(
  filename: string,
  params?: Record<string, string | number>
): string {
  const __filename = new URL(import.meta.url).pathname;
  const __dirname = path.dirname(__filename);
  const snippetPath = path.join(__dirname, "../templates", filename);
  let content = fs.readFileSync(snippetPath, "utf-8");
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      const regex = new RegExp(`\\{\\{${key}\\}\}`, "g");
      content = content.replace(regex, String(value));
    }
  }
  return content;
}
