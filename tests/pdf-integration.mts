import { writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import * as pluginRoot from "@getpaseo/plugin";
import * as pluginServer from "@getpaseo/plugin/server";
import { build } from "esbuild";
import * as zod from "zod";

const validation = resolve(process.cwd(), ".validation", "doc-viewer-pdf");
const workspace = resolve(validation, "workspace");
mkdirSync(workspace, { recursive: true });
// Entirely fictional, self-contained three-page PDF; no external fixture or user data.
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>',
];
for (let page = 0; page < 3; page++) {
  const stream = `BT /F1 24 Tf 60 740 Td (Atlas Field Notes - Page ${page + 1}) Tj 0 -40 Td /F1 12 Tf (Fictional project report for document-viewer validation.) Tj ET`;
  objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 9 0 R >> >> /Contents ${4 + page * 2} 0 R >>`);
  objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
}
objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
let pdf = '%PDF-1.4\n';const offsets = [0];
objects.forEach((body,index)=>{offsets.push(Buffer.byteLength(pdf));pdf += `${index+1} 0 obj\n${body}\nendobj\n`;});
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
pdf += offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('');
pdf += `trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
writeFileSync(resolve(workspace, "statement.pdf"),pdf);

const compiled = await build({
  entryPoints: [resolve(process.cwd(), "index.server.ts")],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  external: ["@getpaseo/plugin", "@getpaseo/plugin/server", "@getpaseo/plugin/server/provider", "@getpaseo/plugin/server/acp", "@getpaseo/plugin/server/usage", "@getpaseo/plugin/client", "@getpaseo/plugin/client/react-native", "@getpaseo/plugin/client/ui", "zod"],
  write: false,
});
const source = compiled.outputFiles[0]?.text;
if (!source) throw new Error("Server bundle was empty");
const bundle = `(function(require) { const module = { exports: {} }; const exports = module.exports; ${source.replaceAll("get: () => from[key]", "value: from[key]")} return module.exports; })`;
const evaluate: (source: string) => unknown = globalThis.eval;
const factory = evaluate(bundle) as (require: (name: string) => unknown) => { default?: unknown };
const outside = createRequire(resolve(validation, "outside-plugin.cjs"));
const host: Record<string, unknown> = {
  "@getpaseo/plugin": pluginRoot,
  "@getpaseo/plugin/server": pluginServer,
  zod,
};
const contribute = factory((name) => host[name] ?? outside(name)).default as (server: unknown) => () => void;
const handlers = new Map<string, (input: unknown, context: unknown) => Promise<unknown>>();
let lifecycleSubscriptions = 0;
contribute({
  registerSettings: () => ({}),
  on: () => { lifecycleSubscriptions++; return () => {}; },
  handle: (contract: { name: string }, handler: never) => handlers.set(contract.name, handler),
} as never);

const paseo = {
  workspaces: {
    list: async () => ({
      entries: [{ id: "synthetic-workspace", workspaceDirectory: workspace, projectRootPath: workspace }],
      pageInfo: { hasMore: false },
    }),
  },
};
const opened = await handlers.get("doc.open")!({ workspaceId: "synthetic-workspace", path: "statement.pdf" }, { paseo }) as { kind: string; pageCount: number };
const page = await handlers.get("doc.page")!({ workspaceId: "synthetic-workspace", path: "statement.pdf", index: 0, maxWidth: 400 }, { paseo }) as { kind: string; image: { width: number; data: string } };
if (opened.kind !== "pdf" || opened.pageCount !== 3 || page.kind !== "pdf" || page.image.width !== 400 || lifecycleSubscriptions !== 0) {
  throw new Error(`Unexpected plugin result: ${JSON.stringify({ opened, page: { kind: page.kind, width: page.image.width }, lifecycleSubscriptions })}`);
}
console.log(JSON.stringify({ opened, page: { kind: page.kind, width: page.image.width, bytesBase64: page.image.data.length }, lifecycleSubscriptions }));
process.exit(0);
