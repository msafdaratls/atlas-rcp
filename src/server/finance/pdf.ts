import { readFile } from "node:fs/promises";
import path from "node:path";
import { type Browser, chromium } from "playwright";

let browserPromise: Promise<Browser> | null = null;

/**
 * One warm Chromium instance per process instead of launching fresh per PDF
 * (~200-500ms + ~100-300MB RSS each) — relaunches only if the cached browser
 * has crashed/disconnected. Each render still gets its own isolated
 * BrowserContext (closed per call) so concurrent renders never share state.
 */
async function getBrowser(): Promise<Browser> {
  if (browserPromise) {
    const browser = await browserPromise;
    if (browser.isConnected()) return browser;
    browserPromise = null;
  }
  browserPromise = chromium.launch({ headless: true });
  return browserPromise;
}

async function fontFace(family: string, fileName: string, weight: number) {
  const filePath = path.join(process.cwd(), "src/fonts", fileName);
  const buf = await readFile(filePath);
  const b64 = buf.toString("base64");
  return `@font-face{font-family:'${family}';src:url(data:font/woff2;base64,${b64}) format('woff2');font-weight:${weight};font-style:normal;font-display:block;}`;
}

export async function embeddedFontCss(): Promise<string> {
  const faces = await Promise.all([
    fontFace("Montserrat", "montserrat-latin-400-normal.woff2", 400),
    fontFace("Montserrat", "montserrat-latin-600-normal.woff2", 600),
    fontFace("Montserrat", "montserrat-latin-700-normal.woff2", 700),
    fontFace("IBM Plex Mono", "ibm-plex-mono-latin-400-normal.woff2", 400),
    fontFace("IBM Plex Mono", "ibm-plex-mono-latin-500-normal.woff2", 500),
    fontFace("Atlas Arabic", "arabic-ui-400.woff2", 400),
    fontFace("Atlas Arabic", "arabic-ui-600.woff2", 600),
    fontFace("Atlas Arabic", "arabic-ui-700.woff2", 700),
  ]);
  return faces.join("\n");
}

/**
 * Render HTML to PDF via Playwright. Fonts must be embedded in the HTML
 * (see embeddedFontCss) — never fetch fonts from a CDN at render time.
 */
export async function htmlToPdf(html: string): Promise<Buffer> {
  const browser = await getBrowser();
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "16mm", right: "12mm", bottom: "16mm", left: "12mm" },
    });
    return Buffer.from(pdf);
  } finally {
    await context.close();
  }
}
