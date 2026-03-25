#!/usr/bin/env node

import { program } from "commander";
import puppeteer, { Browser, Page } from "puppeteer";
import { PDFDocument } from "pdf-lib";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const SLIDE_TRANSITION_DELAY_MS = 300;
const SLIDE_NUMBER_PADDING = 4;

program
  .name("revealjs-pdf-export")
  .description("Export a Reveal.js presentation to a PDF file")
  .argument("<url>", "URL of the Reveal.js presentation")
  .argument(
    "[output]",
    "Output PDF file path (defaults to the page title with .pdf extension)"
  )
  .option("--no-sandbox", "Disable Chromium sandbox (useful in CI environments)")
  .parse(process.argv);

const [url, outputArg] = program.args;
const opts = program.opts();

async function getPageTitle(page: Page): Promise<string> {
  return page.title();
}

async function resolveOutputPath(
  page: Page,
  outputArg: string | undefined
): Promise<string> {
  if (outputArg) {
    return path.resolve(outputArg);
  }
  const title = await getPageTitle(page);
  const safeName =
    title.replace(/[^a-zA-Z0-9\-_ ]/g, "").trim() || "presentation";
  return path.resolve(`${safeName}.pdf`);
}

interface SlideInfo {
  hIndex: number;
  vIndex: number;
}

async function getAllSlides(page: Page): Promise<SlideInfo[]> {
  return page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reveal = (globalThis as any).Reveal;
    if (!reveal) {
      throw new Error("Reveal.js not found on the page");
    }

    const slides: { hIndex: number; vIndex: number }[] = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const horizontalSlides: any[] = Array.from(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).document.querySelectorAll(".reveal .slides > section")
    );

    for (let h = 0; h < horizontalSlides.length; h++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const verticalSlides: any[] = Array.from(
        horizontalSlides[h].querySelectorAll("section")
      );
      if (verticalSlides.length > 0) {
        for (let v = 0; v < verticalSlides.length; v++) {
          slides.push({ hIndex: h, vIndex: v });
        }
      } else {
        slides.push({ hIndex: h, vIndex: 0 });
      }
    }

    return slides;
  });
}

async function hideControls(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      .reveal .controls,
      .reveal .progress,
      .reveal .slide-number,
      .reveal .speaker-notes-pdf {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
      }
    `,
  });
}

async function navigateToSlide(
  page: Page,
  hIndex: number,
  vIndex: number
): Promise<void> {
  await page.evaluate(
    (h: number, v: number) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).Reveal.slide(h, v);
    },
    hIndex,
    vIndex
  );
  await new Promise((resolve) => setTimeout(resolve, SLIDE_TRANSITION_DELAY_MS));
}

async function takeScreenshot(
  page: Page,
  filePath: string
): Promise<void> {
  await page.screenshot({ path: filePath as `${string}.png`, fullPage: false });
}

async function mergeScreenshotsToPdf(
  screenshotPaths: string[],
  outputPath: string
): Promise<void> {
  const pdfDoc = await PDFDocument.create();

  for (const screenshotPath of screenshotPaths) {
    const imageBytes = fs.readFileSync(screenshotPath);
    const image = await pdfDoc.embedPng(imageBytes);
    const { width, height } = image.scale(1);
    const page = pdfDoc.addPage([width, height]);
    page.drawImage(image, { x: 0, y: 0, width, height });
  }

  const pdfBytes = await pdfDoc.save();
  fs.writeFileSync(outputPath, pdfBytes);
}

async function main(): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "revealjs-pdf-"));
  const screenshotPaths: string[] = [];

  const launchArgs: string[] = [];
  if (opts.sandbox === false) {
    launchArgs.push("--no-sandbox", "--disable-setuid-sandbox");
  }

  let browser: Browser | null = null;

  try {
    console.log(`Opening presentation: ${url}`);
    browser = await puppeteer.launch({
      headless: true,
      args: launchArgs,
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

    // Wait for Reveal.js to initialise
    await page.waitForFunction(
      () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        typeof (globalThis as any).Reveal !== "undefined" &&
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).Reveal.isReady(),
      { timeout: 30000 }
    );

    await hideControls(page);

    const outputPath = await resolveOutputPath(page, outputArg);
    const slides = await getAllSlides(page);

    if (slides.length === 0) {
      throw new Error("No slides found in the presentation.");
    }

    console.log(`Found ${slides.length} slide(s). Taking screenshots...`);

    for (let i = 0; i < slides.length; i++) {
      const { hIndex, vIndex } = slides[i];
      await navigateToSlide(page, hIndex, vIndex);

      const screenshotPath = path.join(tempDir, `slide-${String(i).padStart(SLIDE_NUMBER_PADDING, "0")}.png`);
      await takeScreenshot(page, screenshotPath);
      screenshotPaths.push(screenshotPath);
      console.log(`  Screenshot ${i + 1}/${slides.length} saved`);
    }

    console.log(`Merging ${screenshotPaths.length} screenshots into PDF...`);
    await mergeScreenshotsToPdf(screenshotPaths, outputPath);
    console.log(`PDF saved to: ${outputPath}`);
  } finally {
    if (browser) {
      await browser.close();
    }

    // Delete temporary screenshots
    for (const p of screenshotPaths) {
      try {
        fs.unlinkSync(p);
      } catch {
        // Ignore cleanup errors
      }
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

main().catch((err: unknown) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
