import { mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuildBuild } from "esbuild";
import { build as viteBuild } from "vite";
import webpack from "webpack";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const browserRoot = resolve(root, "test", "browser");
const consumersRoot = resolve(browserRoot, "consumers");
const outputRoot = resolve(browserRoot, ".out");
const aliases = {
  "mp4-to-gif-wasm/worker": resolve(root, "dist", "worker.js"),
  "mp4-to-gif-wasm": resolve(root, "dist", "index.js")
};

mkdirSync(outputRoot, { recursive: true });

for (const consumerName of ["vite", "react-vite", "vue-vite"]) {
  await viteBuild({
    configFile: false,
    root: resolve(consumersRoot, consumerName),
    publicDir: false,
    base: "./",
    resolve: {
      alias: aliases
    },
    build: {
      outDir: resolve(outputRoot, consumerName),
      emptyOutDir: true
    }
  });
}

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
      alias: aliases,
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

await esbuildBuild({
  absWorkingDir: root,
  alias: aliases,
  bundle: true,
  entryPoints: [resolve(consumersRoot, "esbuild", "main.js")],
  format: "esm",
  outfile: resolve(outputRoot, "esbuild", "main.js"),
  loader: {
    ".wasm": "file"
  },
  plugins: [
    {
      name: "wasm-url",
      setup(build) {
        build.onResolve({ filter: /\.wasm\?url$/ }, (args) => ({
          path: resolve(args.resolveDir, args.path.replace(/\?url$/, "")),
          namespace: "wasm-url"
        }));
        build.onLoad({ filter: /.*/, namespace: "wasm-url" }, async (args) => ({
          contents: await readFile(args.path),
          loader: "file"
        }));
      }
    }
  ]
});

const esbuildHtmlPath = resolve(outputRoot, "esbuild", "index.html");
mkdirSync(dirname(esbuildHtmlPath), { recursive: true });
writeFileSync(esbuildHtmlPath, `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>esbuild consumer</title>
  </head>
  <body data-bundler="esbuild" data-framework="vanilla">
    <main id="app">esbuild consumer</main>
    <script type="module" src="./main.js"></script>
  </body>
</html>
`);
