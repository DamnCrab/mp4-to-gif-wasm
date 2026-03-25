import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/browser",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:4175"
  },
  webServer: {
    command: "node ./test/browser/server.mjs",
    url: "http://127.0.0.1:4175/test/browser/fixture.html",
    reuseExistingServer: !process.env.CI
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium"
      }
    },
    {
      name: "firefox",
      use: {
        browserName: "firefox"
      }
    },
    {
      name: "webkit",
      use: {
        browserName: "webkit"
      }
    }
  ]
});
