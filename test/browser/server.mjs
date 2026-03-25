import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";

const root = resolve(process.cwd());
const port = 4175;

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm"
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  const pathname = url.pathname === "/" ? "/test/browser/fixture.html" : url.pathname;
  const filePath = resolve(root, `.${pathname}`);

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("forbidden");
    return;
  }

  try {
    const body = await readFile(filePath);
    const ext = extname(filePath);
    response.writeHead(200, {
      "content-type": contentTypes[ext] ?? "application/octet-stream"
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`browser test server listening on ${port}`);
});
