import { expect, test } from "@playwright/test";

const pages = [
  {
    pathname: "/test/browser/.out/vite/index.html",
    bundler: "vite",
    framework: "vanilla"
  },
  {
    pathname: "/test/browser/.out/react-vite/index.html",
    bundler: "vite",
    framework: "react"
  },
  {
    pathname: "/test/browser/.out/vue-vite/index.html",
    bundler: "vite",
    framework: "vue"
  },
  {
    pathname: "/test/browser/.out/webpack/index.html",
    bundler: "webpack",
    framework: "vanilla"
  },
  {
    pathname: "/test/browser/.out/esbuild/index.html",
    bundler: "esbuild",
    framework: "vanilla"
  }
];

for (const { pathname, bundler, framework } of pages) {
  test(`loads the package through ${bundler} (${framework})`, async ({ page }) => {
    await page.goto(pathname);
    await expect.poll(async () => {
      return await page.locator("body").getAttribute("data-status");
    }).toBe("ok");

    await expect(page.locator("body")).toHaveAttribute("data-header", "GIF89a");
    await expect(page.locator("body")).toHaveAttribute("data-worker", "function");
    await expect(page.locator("body")).toHaveAttribute("data-bundler", bundler);
    await expect(page.locator("body")).toHaveAttribute("data-framework", framework);
  });
}
