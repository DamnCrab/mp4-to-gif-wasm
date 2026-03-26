import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build as viteBuild } from "vite";
import webpack from "webpack";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const browserRoot = resolve(root, "test", "browser");
const consumersRoot = resolve(browserRoot, "consumers");
const outputRoot = resolve(browserRoot, ".out");

mkdirSync(outputRoot, { recursive: true });

await viteBuild({
  configFile: false,
  root: resolve(consumersRoot, "vite"),
  publicDir: false,
  base: "./",
  resolve: {
    alias: {
      "mp4-to-gif-wasm/worker": resolve(root, "dist", "worker.js"),
      "mp4-to-gif-wasm": resolve(root, "dist", "index.js")
    }
  },
  build: {
    outDir: resolve(outputRoot, "vite"),
    emptyOutDir: true
  }
});

await new Promise((resolvePromise, rejectPromise) => {
  const compiler = webpack({
    mode: "production",
    target: "web",
    context: resolve(consumersRoot, "webpack"),
    entry: "./main.js",
    output: {
      path: resolve(outputRoot, "webpack"),
      filename: "main.js",
      clean: true
    },
    resolve: {
      alias: {
        "mp4-to-gif-wasm/worker": resolve(root, "dist", "worker.js"),
        "mp4-to-gif-wasm": resolve(root, "dist", "index.js")
      },
      extensionAlias: {
        ".js": [".js", ".mjs"]
      }
    },
    experiments: {
      asyncWebAssembly: true
    },
    module: {
      rules: [
        {
          resourceQuery: /url/,
          type: "asset/resource"
        }
      ]
    }
  });

  compiler.run((error, stats) => {
    compiler.close(() => {
      if (error) {
        rejectPromise(error);
        return;
      }
      if (!stats || stats.hasErrors()) {
        rejectPromise(new Error(stats?.toString({ all: false, errors: true }) ?? "webpack build failed"));
        return;
      }
      resolvePromise();
    });
  });
});

const webpackHtmlPath = resolve(outputRoot, "webpack", "index.html");
mkdirSync(dirname(webpackHtmlPath), { recursive: true });
writeFileSync(webpackHtmlPath, `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>webpack consumer</title>
  </head>
  <body data-bundler="webpack">
    <main id="app">webpack consumer</main>
    <script src="./main.js"></script>
  </body>
</html>
`);
