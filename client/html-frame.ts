import { createElement, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { HTML_PREVIEW_SANDBOX, htmlPreviewSource } from '../shared/html-preview';

export type HtmlFrameProblem = 'too-large' | 'failed';

// The web frame for an HTML preview, as in getpaseo/paseo
// packages/app/src/file-panels/html-preview.web.tsx. Only call it on the web (react-dom).
// The frame is keyed by its URL, so each document loads in a new frame. Building the URL never
// throws out of render: a URL that is too long, or any failure, renders `fallback` instead.
export function HtmlFrame({ html, title = 'HTML preview', fallback }: { html: string; title?: string; fallback: (problem: HtmlFrameProblem) => ReactNode }): ReactElement {
  const source = useMemo((): string | HtmlFrameProblem => {
    try { return htmlPreviewSource(html) ?? 'too-large'; } catch { return 'failed'; }
  }, [html]);
  if (source === 'too-large' || source === 'failed') return createElement('div', { 'data-testid': 'html-preview-unavailable' }, fallback(source));
  return createElement('iframe', {
    key: source,
    title,
    'data-testid': 'html-preview-frame',
    src: source,
    sandbox: HTML_PREVIEW_SANDBOX,
    referrerPolicy: 'no-referrer',
    style: { flex: 1, minHeight: 0, width: '100%', border: 'none', backgroundColor: 'white' },
  });
}

// The latest value once it has stopped changing for `ms`. The first value is used immediately.
export function useDebouncedValue<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (Object.is(value, settled)) return;
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}
