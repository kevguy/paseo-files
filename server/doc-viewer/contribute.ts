import { fileInfo, fileChunk } from "./files";
import { markOpened, markReviewed, openedRevisions, readViewerState, setPin, stateDirectory, viewerStateStore } from "./viewer-state";
import { TipsStore } from "./tips";
import { DocumentViewStore } from "./documents-view";
import { VisitStore } from "./visits";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { searchDocument, listRecent, openDocument, readBlocks, readMediaChunk, readPageText, readRows, readCell, renderPage, renderThumbnail, scanIssues, renderReviewPage } from "./documents";
import { searchGenerations } from "./search";
import { workspacePath, workspaceRoot } from "./paths";
import { forgetScan, hasDocuments } from "./recent";
import { viewerSettings } from "../../shared/doc-viewer/settings";
import { docBlocksRpc, docIssuesRpc, docOpenRpc, docPageRpc, docRowsRpc, docCellRpc, docsRecentRpc, docsVisitRpc, docsAnyRpc, docTextRpc, docThumbnailRpc, mediaChunkRpc, fileInfoRpc, fileChunkRpc, docLocateRpc, docSearchRpc, tipsDismissRpc, tipsReadRpc, documentsViewReadRpc, documentsViewWriteRpc, viewerStateOpenedRevisionsRpc, viewerStateOpenedRpc, viewerStatePinRpc, viewerStateReadRpc, viewerStateReviewRpc, viewerStateWriteRpc, reviewPageImageRpc } from "../../shared/doc-viewer/rpc";

// Workspace roots are salted with the viewer-state secret, so the file does not reveal them.
const visitStore = new VisitStore(stateDirectory(), async (root) => (await viewerStateStore.scannedKeys(root))(""));
const tipsStore = new TipsStore(stateDirectory());
const viewStore = new DocumentViewStore(stateDirectory());

export default function contribute(server: PluginServerContext) {
  server.registerSettings(viewerSettings);
  server.handle(docOpenRpc, async ({ workspaceId, path, password }, { paseo }) =>
    openDocument({ root: await workspaceRoot(paseo, workspaceId), path, password }),
  );
  server.handle(docPageRpc, async ({ workspaceId, path, password, ...request }, { paseo }) =>
    renderPage({ root: await workspaceRoot(paseo, workspaceId), path, password }, request),
  );
  server.handle(docThumbnailRpc, async ({ workspaceId, path, password, ...request }, { paseo }) =>
    renderThumbnail({ root: await workspaceRoot(paseo, workspaceId), path, password }, request),
  );
  server.handle(docTextRpc, async ({ workspaceId, path, password, ...request }, { paseo }) =>
    readPageText({ root: await workspaceRoot(paseo, workspaceId), path, password }, request),
  );
  server.handle(docRowsRpc, async ({ workspaceId, path, ...request }, { paseo }) =>
    readRows({ root: await workspaceRoot(paseo, workspaceId), path }, request),
  );
  server.handle(docCellRpc, async ({ workspaceId, path, ...request }, { paseo }) =>
    readCell({ root: await workspaceRoot(paseo, workspaceId), path }, request),
  );
  server.handle(docIssuesRpc, async ({ workspaceId, path, cursor }, { paseo }) =>
    scanIssues({ root: await workspaceRoot(paseo, workspaceId), path }, cursor),
  );
  server.handle(docBlocksRpc, async ({ workspaceId, path, ...request }, { paseo }) =>
    readBlocks({ root: await workspaceRoot(paseo, workspaceId), path }, request),
  );
  server.handle(mediaChunkRpc, async ({ workspaceId, path, ...request }, { paseo }) =>
    readMediaChunk({ root: await workspaceRoot(paseo, workspaceId), path }, request),
  );
  server.handle(docsRecentRpc, async ({ workspaceId, since, ...request }, { paseo }) => {
    const list = await listRecent(await workspaceRoot(paseo, workspaceId), request);
    return list.version === since ? { unchanged: true as const, version: list.version } : list;
  });
  server.handle(docsVisitRpc, async ({ workspaceId }, { paseo }) => ({ since: await visitStore.visit(await workspaceRoot(paseo, workspaceId)) }));
  server.handle(docsAnyRpc, async ({ workspaceId }, { paseo }) => ({ found: await hasDocuments(await workspaceRoot(paseo, workspaceId)) }));
  server.handle(fileInfoRpc, async ({ workspaceId, path }, { paseo }) =>
    fileInfo(await workspaceRoot(paseo, workspaceId), path),
  );
  server.handle(fileChunkRpc, async ({ workspaceId, path, revision, offset, length }, { paseo }) =>
    fileChunk(await workspaceRoot(paseo, workspaceId), path, revision, offset, length),
  );
  server.handle(docLocateRpc, async ({ workspaceId, absolutePath }, { paseo }) =>
    ({ path: await workspacePath(await workspaceRoot(paseo, workspaceId), absolutePath) }),
  );
  server.handle(docSearchRpc, async ({ workspaceId, path, password, query, cursor, searchId }, { paseo }) =>
    searchDocument({ root: await workspaceRoot(paseo, workspaceId), path, password }, query, cursor, undefined,
      searchId && searchGenerations.begin(searchId.session, searchId.generation)),
  );
  server.handle(viewerStateReadRpc, async ({ workspaceId, path }, { paseo }) =>
    readViewerState(viewerStateStore, await workspaceRoot(paseo, workspaceId), path),
  );
  server.handle(viewerStateWriteRpc, async ({ workspaceId, path, position }, { paseo }) => {
    const key = await viewerStateStore.key(await workspaceRoot(paseo, workspaceId), path);
    await viewerStateStore.write(key, position);
    return { saved: true };
  });
  server.handle(viewerStatePinRpc, async ({ workspaceId, path, index, pin }, { paseo }) =>
    setPin(viewerStateStore, await workspaceRoot(paseo, workspaceId), path, index, pin),
  );
  server.handle(viewerStateReviewRpc, async ({ workspaceId, path, revision }, { paseo }) => {
    const root = await workspaceRoot(paseo, workspaceId);
    const answer = await markReviewed(viewerStateStore, root, path, revision);
    forgetScan(root);
    return answer;
  });
  server.handle(viewerStateOpenedRpc, async ({ workspaceId, path, revision }, { paseo }) => {
    const root = await workspaceRoot(paseo, workspaceId);
    const marked = await markOpened(viewerStateStore, root, path, revision);
    if (marked) forgetScan(root);
    return { marked };
  });
  server.handle(viewerStateOpenedRevisionsRpc, async ({ workspaceId, paths }, { paseo }) =>
    ({ opened: await openedRevisions(viewerStateStore, await workspaceRoot(paseo, workspaceId), paths) }),
  );
  server.handle(tipsReadRpc, () => tipsStore.read());
  server.handle(tipsDismissRpc, () => tipsStore.dismiss());
  server.handle(documentsViewReadRpc, () => viewStore.read());
  server.handle(documentsViewWriteRpc, ({ layout, view }) => viewStore.write(layout, view));
  server.handle(reviewPageImageRpc, async ({ workspaceId, path, password, ...request }, { paseo }) =>
    renderReviewPage({ root: await workspaceRoot(paseo, workspaceId), path, password }, request),
  );
  return () => {};
}
