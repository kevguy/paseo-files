# Integration changes

Source modules live in `client/doc-viewer`, `server/doc-viewer` and `shared/doc-viewer` to satisfy Paseo's compiler boundaries. Relative imports are remapped; upstream contribution entries are named `contribute.ts(x)`. Licenses and attribution remain here.

Upstream 5b7cee29d7e9d57505b9e435bdf7af0a78a126ff. Bundled as a source dependency for direct PDF opening from Files & Notes. Integration changes will be listed here; no claim of original authorship for viewer code.

- `index.server.ts`: removed agent lifecycle listeners and changed-document timeline cards. The Files & Notes viewer does not observe agent turns or append timeline items.
- `server/viewer-state.ts`: moved persistent state under `paseo-files/doc-viewer` and renamed the optional override to `PASEO_FILES_DOC_VIEWER_STATE_DIR`, so it cannot share the separately installed `paseo-doc-viewer` state by default.
