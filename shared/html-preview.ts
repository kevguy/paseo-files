// Rendered preview for HTML files, mirroring Paseo's own HTML preview:
// getpaseo/paseo packages/app/src/file-panels/html-preview-csp.ts (policy and prologue) and
// packages/app/src/file-panels/html-preview.web.tsx (data URL and sandboxed frame).
//
// The policy lets a self-contained page keep its inline styles and scripts (charts, diagrams) and
// refuses every network fetch: remote scripts, styles, fonts, images, fetch/XHR/WebSocket, form
// posts and nested frames. It does not stop the page navigating itself; on the web the opaque
// origin from the sandbox is what bounds that.
export const HTML_PREVIEW_EXTENSIONS: readonly string[] = ['html', 'htm'];

export function isHtmlPreviewPath(path: string): boolean {
  const name = path.split('/').pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot > 0 && HTML_PREVIEW_EXTENSIONS.includes(name.slice(dot + 1).toLowerCase());
}

export const HTML_PREVIEW_POLICY = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' blob:",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "object-src 'none'",
].join('; ');

// A meta CSP only applies while the parser is still in <head>, so the policy is not inserted into
// the file: our doctype and the policy come first, then the file verbatim. The file's own doctype
// becomes a stray token the parser ignores, and nothing in the file has to be parsed.
export const HTML_PREVIEW_PROLOGUE = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${HTML_PREVIEW_POLICY}">`;

const BOM = '\uFEFF';

export function withPreviewCsp(html: string): string {
  return HTML_PREVIEW_PROLOGUE + (html.startsWith(BOM) ? html.slice(BOM.length) : html);
}

// encodeURIComponent throws on a lone UTF-16 surrogate, which a draft can contain. Replace each with
// U+FFFD, as String.prototype.toWellFormed does (ES2024; not in every runtime yet).
export function wellFormed(text: string): string {
  const native = (text as unknown as { toWellFormed?: () => string }).toWellFormed;
  if (typeof native === 'function') return native.call(text);
  return text.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g, (unit) => (unit.length === 2 ? unit : '\uFFFD'));
}

// A document URL (not srcdoc, which would inherit the app's URL) so fragment links stay inside the
// preview.
export function htmlPreviewUrl(html: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(wellFormed(withPreviewCsp(html)))}`;
}

// Chromium passes no URL longer than 2 MiB between processes (url::kMaxURLChars), so a longer frame
// URL leaves the frame blank. A saved file (512 KiB at most) encodes to under 1.6 MiB; a draft edited
// or pasted past the limit can go over.
export const HTML_PREVIEW_MAX_URL_LENGTH = 2 * 1024 * 1024;

// The frame URL for `html`, or null when it is too long to load.
export function htmlPreviewSource(html: string): string | null {
  const url = htmlPreviewUrl(html);
  return url.length > HTML_PREVIEW_MAX_URL_LENGTH ? null : url;
}

// `allow-scripts` alone: an opaque origin with no access to Paseo's DOM, cookies or storage, no
// popups and no top-level navigation.
export const HTML_PREVIEW_SANDBOX = 'allow-scripts';

export const HTML_PREVIEW_DEBOUNCE_MS = 300;
