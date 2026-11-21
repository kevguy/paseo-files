import contributeDocuments from "./server/doc-viewer/contribute";
import type { PluginHandlerContext, PluginServerContext } from "@getpaseo/plugin/server";
import { browse, listWorkspaces, locate, readText, saveText, search } from "./server/files";
import { browseRpc, locateRpc, readRpc, saveRpc, searchRpc, workspacesRpc } from "./shared/files";

export default function contribute(server: PluginServerContext) {
  server.handle(workspacesRpc, (_input, { paseo }) => listWorkspaces(paseo as PluginHandlerContext["paseo"]));
  server.handle(browseRpc, async ({ workspaceId, path }, { paseo }) => browse(await workspaceRoot(paseo, workspaceId), path));
  server.handle(searchRpc, async ({ workspaceId, scope, query, mode, caseSensitive }, { paseo }) => search(await workspaceRoot(paseo, workspaceId), scope, query, mode, caseSensitive));
  server.handle(readRpc, async ({ workspaceId, path }, { paseo }) => readText(await workspaceRoot(paseo, workspaceId), path));
  server.handle(saveRpc, async ({ workspaceId, path, text, revision }, { paseo }) => saveText(await workspaceRoot(paseo, workspaceId), path, text, revision));
  server.handle(locateRpc, async ({ workspaceId, absolutePath }, { paseo }) => locate(await workspaceRoot(paseo, workspaceId), absolutePath));
  return contributeDocuments(server);
}

async function workspaceRoot(paseo: PluginHandlerContext["paseo"], workspaceId: string): Promise<string> {
  let cursor: string | undefined;
  for (let page = 0; page < 100; page++) {
    const result = await paseo.workspaces.list({ filter: { query: workspaceId }, page: { limit: 200, ...(cursor ? { cursor } : {}) } });
    const item = result.entries.find((entry) => entry.id === workspaceId);
    if (item) {
      const path = item.workspaceDirectory || item.projectRootPath;
      if (!path) throw new Error("Selected workspace has no local directory");
      return path;
    }
    const next = result.pageInfo?.nextCursor;
    if (!result.pageInfo?.hasMore || !next || next === cursor) break;
    cursor = next;
  }
  throw new Error("Selected workspace was not found");
}
