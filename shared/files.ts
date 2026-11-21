import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const workspaceId = z.string().min(1).max(256);
const relativePath = z.string().max(4096);

export const workspacesRpc = defineRpc({
  name: "files.workspaces",
  input: z.object({}),
  output: z.object({ workspaces: z.array(z.object({ id: z.string(), name: z.string(), path: z.string() })) }),
});

export const browseRpc = defineRpc({
  name: "files.browse",
  input: z.object({ workspaceId, path: relativePath.default("") }),
  output: z.object({ path: z.string(), entries: z.array(z.object({ path: z.string(), name: z.string(), kind: z.enum(["file", "directory"]) })), limited: z.boolean() }),
});

export const searchRpc = defineRpc({
  name: "files.search",
  input: z.object({ workspaceId, scope: relativePath.default(""), query: z.string().min(1).max(256), mode: z.enum(["names", "content"]), caseSensitive: z.boolean().default(false) }),
  output: z.object({ entries: z.array(z.object({ path: z.string(), kind: z.enum(["file", "directory"]), line: z.number().optional(), preview: z.string().optional() })), limited: z.boolean(), engine: z.string() }),
});

export const readRpc = defineRpc({
  name: "files.read",
  input: z.object({ workspaceId, path: relativePath }),
  output: z.object({ path: z.string(), text: z.string(), revision: z.string() }),
});

export const saveRpc = defineRpc({
  name: "files.save",
  input: z.object({ workspaceId, path: relativePath, text: z.string().max(512 * 1024), revision: z.string().min(1).max(128) }),
  output: z.object({ path: z.string(), text: z.string(), revision: z.string() }),
});

export const locateRpc = defineRpc({
  name: "files.locate",
  input: z.object({ workspaceId, absolutePath: z.string().min(1).max(4096) }),
  output: z.object({ path: z.string() }),
});

export type Workspace = z.infer<typeof workspacesRpc.output>["workspaces"][number];
export type BrowseResult = z.infer<typeof browseRpc.output>;
export type SearchResult = z.infer<typeof searchRpc.output>;
export type ReadResult = z.infer<typeof readRpc.output>;
export type SaveResult = z.infer<typeof saveRpc.output>;
