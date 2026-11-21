import { documentRevision } from "../../shared/doc-viewer/revision";

// Revisions describe file metadata only: a rewrite with identical size and times keeps its revision.
export function revisionOf(info: { size: number; mtimeMs: number; ctimeMs: number }): string {
  return documentRevision(info.size, info.mtimeMs, info.ctimeMs);
}
