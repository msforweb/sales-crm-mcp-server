import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

const outputDirectory = path.resolve("dist/ui");
await mkdir(outputDirectory, { recursive: true });
const template = await readFile("web/crm-app.html", "utf8");
const result = await build({
  entryPoints: ["web/crm-app.ts"],
  bundle: true,
  minify: true,
  write: false,
  outfile: path.join(outputDirectory, "crm-app.js"),
  platform: "browser",
  format: "iife",
  target: "es2022",
});
const javascript = result.outputFiles.find((file) => file.path.endsWith(".js"))?.text;
const stylesheet = await readFile("web/crm-app.css", "utf8");
if (!javascript) throw new Error("Could not produce the MCP Apps JavaScript bundle.");

const html = template
  .replace('    <link rel="stylesheet" href="./crm-app.css" />', () => `    <style>${stylesheet}</style>`)
  .replace('    <script type="module" src="./crm-app.ts"></script>', () => `    <script>${javascript.replace(/<\/script/gi, "<\\/script")}</script>`);
await writeFile(path.join(outputDirectory, "crm-app.html"), html);
await build({
  entryPoints: ["web/demo-host.ts"], bundle: true, minify: true,
  outfile: path.join(outputDirectory, "demo-host.js"), platform: "browser", format: "iife", target: "es2022",
});
await writeFile(path.join(outputDirectory, "demo-host.html"), await readFile("web/demo-host.html", "utf8"));
