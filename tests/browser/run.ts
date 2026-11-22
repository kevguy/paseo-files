import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '../..');
const output = resolve(root, '.validation/browser');
const fixture = resolve(output, 'fixture');
const markdownPath = join(fixture, 'Projects/Atlas/README.md');
const entry = resolve(root, 'tests/browser/entry.tsx');
const browserPort = 43871;
const pidPath = join(output, 'runner.pid');
const reportPath = join(output, 'report.json');
const screenshots = join(output, 'screenshots');
const browserPidPath = join(output, 'browser.pid');
const rpcErrors: Array<{ path: string; input: unknown; error: string }> = [];

await writeFile(pidPath, `${process.pid}\n`);
await mkdir(screenshots, { recursive: true });
await mkdir(join(fixture, 'Projects/Atlas'), { recursive: true });
await mkdir(join(fixture, 'Archive'), { recursive: true });
// The task items continue the bullet list after a blank line, which makes it a loose list (checkbox inside a
// paragraph); "Next steps" is a separate tight list (checkbox as a block). Keep both shapes.
await writeFile(markdownPath, '# Atlas Project\n\nThis folder contains synthetic workspace notes for browser validation.\n\n## Getting started\n\n- Read the overview\n- Check the **timeline**\n\n- [x] Draft the brief\n- [ ] Book the review\n\nNext steps:\n\n1. [x] Pick a venue\n2. [ ] Send invites\n\n| Phase | Status |\n| --- | --- |\n| Draft | Ready |\n\n```ts\nconst sample = "synthetic";\n```\n\nSee also [[Design Notes|the design note]]. Read the [Report](report.pdf).\n\nSearch marker: browser-checkpoint\n');
await writeFile(join(fixture, 'Projects/Atlas/Design Notes.md'), '# Design Notes\n\nSynthetic linked note for the Atlas fixture.\n');
await writeFile(join(fixture, 'Projects/Atlas/report.pdf'), '%PDF-1.4\nSynthetic PDF fixture for route verification.\n');
await writeFile(join(fixture, 'Projects/Atlas/config.json'), '{"project":"atlas","items":[1,2],"enabled":true}\n');
await writeFile(join(fixture, 'Archive/other.txt'), 'Unrelated synthetic archive note.\n');
const fileApi = await import(pathToFileURL(resolve(root, 'server/files.ts')).href);
await build({
  entryPoints: [entry], outfile: join(output, 'bundle.js'), bundle: true, format: 'iife', platform: 'browser',
  target: ['es2022'], jsx: 'automatic', sourcemap: true, logLevel: 'info',
  alias: { 'react-native': 'react-native-web' },
  plugins: [{
    name: 'synthetic-plugin-sdk',
    setup(builder) {
      builder.onResolve({ filter: /^@getpaseo\/plugin\/client(?:\/ui|\/react-native)?$/ }, args => ({ path: args.path, namespace: 'synthetic-sdk' }));
      builder.onLoad({ filter: /^@getpaseo\/plugin\/client$/, namespace: 'synthetic-sdk' }, () => ({
        loader: 'js', resolveDir: root, contents: `import {useCallback} from 'react'; export function useRpc(contract){return useCallback(async input=>{const r=await fetch('/rpc/'+contract.name,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});const data=await r.json();if(!r.ok)throw new Error(data.error||'RPC failed');return data;},[contract]);}`,
      }));
      builder.onLoad({ filter: /\/ui$/, namespace: 'synthetic-sdk' }, () => ({ loader: 'js', resolveDir: root, contents: `export async function copyText(){}` }));
      builder.onLoad({ filter: /\/react-native$/, namespace: 'synthetic-sdk' }, () => ({ loader: 'js', resolveDir: root, contents: `export function useSafeAreaInsets(){return {bottom:0};}` }));
      builder.onResolve({ filter: /use-bottom-inset$/ }, args => ({ path: `bottom-inset-stub:${args.path}`, namespace: 'synthetic-sdk' }));
      builder.onLoad({ filter: /^bottom-inset-stub:/, namespace: 'synthetic-sdk' }, () => ({ loader: 'js', resolveDir: root, contents: `import {useRef} from 'react'; export function useBottomInset(){return {bottomInset:0,ref:useRef(null),onLayout(){}};}` }));
      builder.onResolve({ filter: /^\.\/doc-viewer\/document-screen$/ }, () => ({ path: 'pdf-stub', namespace: 'synthetic-sdk' }));
      builder.onLoad({ filter: /^pdf-stub$/, namespace: 'synthetic-sdk' }, () => ({ loader: 'tsx', resolveDir: root, contents: `import React from 'react'; import {Text} from 'react-native'; export function DocumentScreen({params}){return <Text>PDF renderer stub: {params.path}</Text>;}` }));
    },
  }],
});

async function body(req: IncomingMessage) {
  let data = '';
  for await (const chunk of req) data += chunk;
  return JSON.parse(data || '{}');
}
const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  let requestPath = req.url ?? '/';
  let requestInput: unknown;
  try {
    const url = new URL(requestPath, `http://127.0.0.1:${browserPort}`);
    if (url.pathname === '/rpc' || url.pathname.startsWith('/rpc/')) {
      const input = await body(req); requestInput = input;
      const rpc = url.pathname.slice(5);
      let data: unknown;
      if (rpc === 'files.browse') data = await fileApi.browse(fixture, input.path ?? '');
      else if (rpc === 'files.search') data = await fileApi.search(fixture, input.scope ?? '', input.query, input.mode, input.caseSensitive ?? false);
      else if (rpc === 'files.read') {
        if (input.path === 'Projects/Atlas/Design Notes.md') await new Promise(resolveDelay => setTimeout(resolveDelay, 900));
        data = await fileApi.readText(fixture, input.path);
      }
      else if (rpc === 'files.save') data = await fileApi.saveText(fixture, input.path, input.text, input.revision);
      else throw new Error(`Unknown RPC ${rpc}`);
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); return;
    }
    if (url.pathname === '/bundle.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(await readFile(join(output, 'bundle.js'))); return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Paseo Files browser validation</title></head><body style="margin:0"><div id="root" style="height:100vh"></div><script src="/bundle.js"></script></body></html>');
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);
    rpcErrors.push({ path: requestPath, input: requestInput, error: message });
    res.writeHead(409, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: message }));
  }
});
server.listen(browserPort, '127.0.0.1');
await new Promise<void>(resolveReady => server.once('listening', resolveReady));
const browserServer = await chromium.launchServer({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
const browserPid = browserServer.process().pid;
await writeFile(browserPidPath, `${browserPid}\n`);
const browser = await chromium.connect(browserServer.wsEndpoint());
const checks: Array<{ name: string; status: 'pass' | 'fail'; details?: string }> = [];
const errors: string[] = [];
const expectedConflictResponses: Array<{ path: string; status: number; error: string }> = [];
let expectedConflictConsoleErrors = 0;
function check(name: string, ok: boolean, details?: string) { checks.push({ name, status: ok ? 'pass' : 'fail', details }); if (!ok) throw new Error(`${name}${details ? `: ${details}` : ''}`); }
function observe(page: import('playwright').Page) {
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.status() !== 409 || new URL(response.url()).pathname !== '/rpc/files.save') return;
    expectedConflictConsoleErrors++;
    void response.json().then(body => expectedConflictResponses.push({ path: new URL(response.url()).pathname, status: response.status(), error: String(body.error ?? '') }));
  });
  page.on('console', message => {
    if (message.type() !== 'error') return;
    if (message.text() === 'Failed to load resource: the server responded with a status of 409 (Conflict)' && expectedConflictConsoleErrors > 0) { expectedConflictConsoleErrors--; return; }
    errors.push(message.text());
  });
}
async function ready(page: import('playwright').Page, params = '') { await page.goto(`http://127.0.0.1:${browserPort}${params}`); await page.getByRole('button', { name: /Projects/ }).waitFor({ timeout: 8000 }); }
async function getEditor(page: import('playwright').Page) {
  const host = page.getByTestId('desktop-code-editor');
  if (await host.count()) { const content = page.locator('.cm-content'); await content.waitFor(); return content; }
  return page.getByLabel('File contents');
}
async function editorText(page: import('playwright').Page) { const target = await getEditor(page); return target.evaluate(el => el instanceof HTMLTextAreaElement ? el.value : (el as HTMLElement).innerText); }
async function waitForFixtureText(marker: string, present = true) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const matches = (await readFile(markdownPath, 'utf8')).includes(marker);
    if (matches === present) return;
    await new Promise(resolveDelay => setTimeout(resolveDelay, 50));
  }
  throw new Error(`Timed out waiting for fixture text ${present ? 'to include' : 'to omit'}: ${marker}`);
}
async function openMarkdownAtFolder(page: import('playwright').Page) {
  await page.getByLabel('Folder path').fill('Projects/Atlas'); await page.getByRole('button', { name: 'Go' }).click();
  await page.getByRole('button', { name: /README\.md/ }).click();
}
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
observe(page);
try {
  await ready(page, '?platform=android');
  const desktopPreview = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  observe(desktopPreview);
  await ready(desktopPreview, '?platform=web&compact=0');
  await openMarkdownAtFolder(desktopPreview);
  await desktopPreview.screenshot({ path: join(screenshots, 'desktop-read.png'), fullPage: false });
  await desktopPreview.getByRole('button', { name: 'Edit', exact: true }).click();
  await desktopPreview.getByRole('button', { name: 'Vim off', exact: true }).click();
  await desktopPreview.getByText(/VIM NORMAL/).waitFor();
  await desktopPreview.getByRole('button', { name: 'Split', exact: true }).click();
  await desktopPreview.screenshot({ path: join(screenshots, 'desktop-split-vim-normal.png'), fullPage: false });
  await desktopPreview.close();
  await page.getByLabel('Search workspace').fill('README');
  await page.getByRole('button', { name: /Open .*README\.md/ }).waitFor();
  check('mobile filename search', true);
  await page.screenshot({ path: join(screenshots, 'mobile-search.png'), fullPage: false });

  await page.getByLabel('Search workspace').fill('');
  await page.getByLabel('Folder path').fill('Projects'); await page.getByRole('button', { name: 'Go' }).click();
  await page.getByRole('button', { name: /Atlas/ }).waitFor();
  await page.getByRole('button', { name: /Atlas/ }).click();
  await page.getByLabel('Folder path').fill('Projects/Atlas'); await page.getByRole('button', { name: 'Go' }).click();
  await page.getByRole('button', { name: /Open .*README\.md/ }).waitFor();
  check('directory navigation by path', true);
  await page.getByRole('button', { name: 'File contents' }).click();
  await page.getByLabel('Search workspace').fill('browser-checkpoint');
  await page.getByText(/Search marker: browser-checkpoint/).waitFor();
  await page.getByRole('button', { name: /README.md line/ }).click();
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await page.getByText('Atlas Project', { exact: true }).waitFor();
  check('content search opens matching markdown line', true);
  await page.screenshot({ path: join(screenshots, 'mobile-markdown.png'), fullPage: false });
  for (const text of ['Getting started', 'Read the overview', 'Phase', 'const sample', 'the design note']) await page.getByText(text, { exact: false }).last().waitFor();
  check('markdown headings, lists, table, code and wiki link rendered', true);
  {
    const done = await page.getByText('Draft the brief').last().boundingBox({ timeout: 5000 }).catch(() => null);
    const mark = await page.getByText('☑', { exact: true }).first().boundingBox({ timeout: 5000 }).catch(() => null);
    const tight = await page.getByText('Pick a venue').last().boundingBox({ timeout: 5000 }).catch(() => null);
    const tightMark = await page.getByText('☑', { exact: true }).last().boundingBox({ timeout: 5000 }).catch(() => null);
    const literal = await page.getByText(/\[[ xX]\]/).filter({ visible: true }).count();
    check('markdown task lists show a checkbox beside the text, without the literal [x]', literal === 0 && !!done && !!mark && Math.abs(done.y - mark.y) < 8 && !!tight && !!tightMark && Math.abs(tight.y - tightMark.y) < 8 && await page.getByText('☐', { exact: true }).count() > 0, JSON.stringify({ tight, tightMark, literal, texts: await page.getByText(/\[[ xX]\]/).filter({ visible: true }).allInnerTexts(), done, mark, open: await page.getByText('☐', { exact: true }).count() }));
  }
  await page.getByRole('link', { name: 'Report', exact: true }).click();
  await page.getByText('PDF renderer stub: Projects/Atlas/report.pdf', { exact: true }).waitFor();
  check('markdown PDF link routes to the document viewer branch (renderer stubbed)', true);
  await page.getByRole('button', { name: /Back to note/ }).click();
  await page.getByRole('link', { name: 'the design note', exact: true }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const pendingEditor = page.getByLabel('File contents');
  await pendingEditor.fill((await pendingEditor.inputValue()) + '\nPending link draft marker');
  await page.getByText(/Your new edits are kept/).waitFor();
  check('delayed Markdown link open preserves edits made while target read is pending', (await pendingEditor.inputValue()).includes('Pending link draft marker') && await page.getByText('README.md', { exact: true }).count() > 0);
  await page.getByRole('button', { name: 'Reload', exact: true }).click();
  await page.getByRole('button', { name: 'Discard and reload', exact: true }).click();
  await page.getByText(/Loaded the latest file/).waitFor();
  check('reload clears the old Undo history', await page.getByRole('button', { name: 'Undo', exact: true }).isDisabled());

  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Heading', exact: true }).click();
  const editor = page.getByLabel('File contents');
  await editor.fill((await editor.inputValue()) + '\nBrowser edit marker');
  await page.getByTestId('tab-modified').getByText('true').waitFor();
  check('replacement tab facade retains the dirty indicator', await page.getByTestId('tab-modified').textContent() === 'true');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await waitForFixtureText('Browser edit marker');
  check('markdown toolbar edit and save writes fixture', (await readFile(markdownPath, 'utf8')).includes('Browser edit marker'));
  await page.screenshot({ path: join(screenshots, 'mobile-editor.png'), fullPage: false });

  await editor.fill((await editor.inputValue()) + '\nConflicting local draft');
  await writeFile(markdownPath, (await readFile(markdownPath, 'utf8')).replace('Browser edit marker', 'External synthetic change'));
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText(/File changed since it was opened/).waitFor();
  check('stale save conflict keeps local editor draft', (await editor.inputValue()).includes('Conflicting local draft'));
  await page.waitForTimeout(50);
  check('stale save conflict returns the expected 409 payload', expectedConflictResponses.some(r => r.path === '/rpc/files.save' && r.status === 409 && r.error.includes('File changed since it was opened')));

  await page.getByRole('button', { name: 'Back to files' }).click();
  await page.getByText(/Keep this draft by saving it/).waitFor();
  check('navigation with unsaved changes asks before discarding', true);
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  check('undo restores previous editor text', !(await editor.inputValue()).includes('Conflicting local draft'));

  // Open a JSON fixture independently after returning to the file list.
  await page.getByRole('button', { name: 'Back to files' }).click();
  await page.getByRole('button', { name: 'Discard changes' }).click();
  await page.getByRole('button', { name: 'Files & folders', exact: true }).click();
  await page.getByLabel('Search workspace').fill('config.json');
  await page.getByRole('button', { name: /config.json/ }).click();
  await page.getByRole('button', { name: 'Format JSON', exact: true }).click();
  check('JSON format action produces indented JSON', (await page.getByLabel('File contents').inputValue()).includes('\n  "project"'));
  await page.getByRole('button', { name: 'Find', exact: true }).click();
  await page.getByLabel('Find in file').fill('atlas'); await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByText('Match selected').waitFor();
  check('find locates a text match', true);
  await page.screenshot({ path: join(screenshots, 'mobile-json-editor.png'), fullPage: false });
  let findInput = page.getByLabel('Find in file');
  await findInput.fill('');
  check('clearing the Find query removes the previous status', await page.getByText('Match selected', { exact: true }).count() === 0);
  await findInput.press('Enter');
  check('empty Find Enter does not report No matches', await page.getByText('No matches', { exact: true }).count() === 0);
  await findInput.fill('missing-synthetic-value'); await findInput.press('Enter');
  await page.getByText('No matches', { exact: true }).waitFor();
  check('a fresh missing Find query reports No matches', true);
  await findInput.fill('atlas');
  check('changing the Find query clears No matches', await page.getByText('No matches', { exact: true }).count() === 0);
  await findInput.fill('missing-synthetic-value'); await findInput.press('Enter');
  await page.getByText('No matches', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Find', exact: true }).click();
  await page.getByRole('button', { name: 'Find', exact: true }).click();
  check('hiding and reopening Find clears its old status', await page.getByText('No matches', { exact: true }).count() === 0);
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  await page.getByText('Copied', { exact: true }).waitFor();
  findInput = page.getByLabel('Find in file');
  await findInput.fill('atlas');
  check('Copy callback/UI feedback survives a Find query reset (copyText SDK stubbed)', await page.getByText('Copied', { exact: true }).count() > 0);

  const desktop = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  observe(desktop);
  await ready(desktop, '?platform=web&compact=0');
  await openMarkdownAtFolder(desktop);
  await desktop.getByRole('button', { name: 'Edit', exact: true }).click();
  let desktopEditor = await getEditor(desktop);
  await desktopEditor.click(); await desktopEditor.press('End'); await desktopEditor.type(' read-edit-history-marker');
  await desktop.getByRole('button', { name: 'Read', exact: true }).click();
  await desktop.getByRole('button', { name: 'Edit', exact: true }).click();
  await desktop.getByRole('button', { name: 'Undo', exact: true }).click();
  check('desktop web Undo survives Read to Edit transition', !(await editorText(desktop)).includes('read-edit-history-marker'));
  desktopEditor = await getEditor(desktop);
  await desktopEditor.click(); await desktopEditor.press('End'); await desktopEditor.type(' split-edit-history-marker');
  await desktop.getByRole('button', { name: 'Split', exact: true }).click();
  await desktop.getByRole('button', { name: 'Edit', exact: true }).click();
  await desktop.getByRole('button', { name: 'Undo', exact: true }).click();
  check('desktop web Undo survives Split to Edit transition', !(await editorText(desktop)).includes('split-edit-history-marker'));
  await desktop.getByRole('button', { name: 'Vim off', exact: true }).click();
  await desktop.getByRole('button', { name: 'Vim on', exact: true }).waitFor();
  try { await desktop.getByText(/VIM NORMAL/).waitFor({ timeout: 5000 }); }
  catch { const bodyText = await desktop.locator('body').innerText(); await desktop.screenshot({ path: join(screenshots, 'desktop-vim-status-failure.png'), fullPage: false }); throw new Error(`Vim enabled but NORMAL indicator missing; body=${bodyText.slice(-500)}; errors=${errors.join(' | ')}`); }
  desktopEditor = await getEditor(desktop);
  await desktopEditor.click(); await desktopEditor.press('Escape'); await desktopEditor.press('i');
  await desktop.getByText(/VIM INSERT/).waitFor();
  await desktopEditor.type('Vim desktop marker');
  await desktopEditor.press('Escape'); await desktop.getByText(/VIM NORMAL/).waitFor();
  await desktopEditor.press(':'); await desktop.keyboard.type('w'); await desktop.keyboard.press('Enter');
  await waitForFixtureText('Vim desktop marker');
  check('desktop web Vim insert + :w saves synthetic fixture', (await readFile(markdownPath, 'utf8')).includes('Vim desktop marker'));
  await desktopEditor.press('Escape'); await desktopEditor.press('g'); await desktopEditor.press('g'); await desktopEditor.press('d'); await desktopEditor.press('d');
  await desktop.getByRole('button', { name: 'Undo', exact: true }).click();
  check('desktop web Vim dd is restored by Undo', (await editorText(desktop)).includes('Vim desktop marker'));
  await desktop.screenshot({ path: join(screenshots, 'desktop-web-editor.png'), fullPage: false });
  await desktop.close();

  const tablet = await browser.newPage({ viewport: { width: 768, height: 1024 }, deviceScaleFactor: 1 });
  observe(tablet);
  await ready(tablet, '?platform=web&compact=1');
  await openMarkdownAtFolder(tablet);
  await tablet.getByRole('button', { name: 'Edit', exact: true }).click();
  await tablet.getByRole('button', { name: 'Vim off', exact: true }).click();
  await tablet.getByRole('button', { name: 'Vim on', exact: true }).waitFor();
  await tablet.getByText(/VIM NORMAL/).waitFor();
  const tabletEditor = await getEditor(tablet);
  await tabletEditor.click(); await tabletEditor.press('Escape'); await tabletEditor.press('i');
  await tablet.getByText(/VIM INSERT/).waitFor();
  await tabletEditor.type('Vim tablet marker');
  await tabletEditor.press('Escape'); await tablet.getByText(/VIM NORMAL/).waitFor();
  await tabletEditor.press(':'); await tablet.keyboard.type('w'); await tablet.keyboard.press('Enter');
  await waitForFixtureText('Vim tablet marker');
  check('compact tablet web Vim :w saves synthetic fixture', (await readFile(markdownPath, 'utf8')).includes('Vim tablet marker'));
  check('compact tablet web hides Split while retaining Vim editor', await tablet.getByRole('button', { name: 'Split', exact: true }).count() === 0);
  await tabletEditor.press('Escape'); await tabletEditor.press('g'); await tabletEditor.press('g'); await tabletEditor.press('d'); await tabletEditor.press('d');
  await tablet.getByRole('button', { name: 'Undo', exact: true }).click();
  check('compact tablet web Vim dd is restored by Undo', (await editorText(tablet)).includes('Vim tablet marker'));
  await tablet.screenshot({ path: join(screenshots, 'tablet-web-editor.png'), fullPage: false });
  await tablet.close();

  check('no browser console or runtime errors', errors.length === 0, errors.join(' | '));
} catch (error) {
  checks.push({ name: 'browser run completed', status: 'fail', details: String(error instanceof Error ? error.message : error) });
  throw error;
} finally {
  await browser.close();
  await browserServer.close();
  await new Promise<void>(resolveStop => server.close(() => resolveStop()));
  await writeFile(pidPath, `${process.pid} stopped\n`);
  await writeFile(browserPidPath, `${browserPid} stopped\n`);
  await writeFile(reportPath, JSON.stringify({ kind: 'synthetic browser proxy; nativeAndroid uses React Native Web platform=android and is not device validation; browser PDF renderer and safe-area hook stubbed', runnerPid: process.pid, browserPid, viewport: '390x844 android-proxy, 1280x900 web, 768x1024 compact-web tablet', counts: { pass: checks.filter(x => x.status === 'pass').length, fail: checks.filter(x => x.status === 'fail').length }, checks, errors, rpcErrors, expectedConflictResponses }, null, 2) + '\n');
}
