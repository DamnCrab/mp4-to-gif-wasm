import { expect, test } from "@playwright/test";

const pages = [
  ["/test/browser/.out/vite/index.html", "vite"],
  ["/test/browser/.out/webpack/index.html", "webpack"]
];

for (const [pathname, bundler] of pages) {
  test(`loads the package through ${bundler}`, async ({ page }) => {
    await page.goto(pathname);
    await expect.poll(async () => {
      return await page.locator("body").getAttribute("data-status");
    }).toBe("ok");

    await expect(page.locator("body")).toHaveAttribute("data-header", "GIF89a");
    await expect(page.locator("body")).toHaveAttribute("data-worker", "function");
  });
}
