// Mounts the real Files panel and checks a save that finishes after the panel was left.
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { labelled, loadComponents, pressable, sleep, texts, theme } from './component-harness';

const source = 'export { FilesPanel, FileEditorPanel } from "./client/files";';
const ui = await loadComponents('files-save', source);
// The same panel from a second evaluation of the bundle, as the host does when it reconnects.
const reloaded = await loadComponents('files-save-reloaded', source);
const { act, renderer, QueryClient, QueryClientProvider } = ui;

let tree: any = null;
afterEach(async () => {
  mock.timers.reset();
  if (tree) await act(async () => tree.unmount());
  tree = null;
});

/** One daemon host with its own copy of notes.md. A save waits until `release` is called. */
function host() {
  const file = { text: 'old text', revision: 'r1' };
  let held: (() => void) | null = null;
  const self = {
    file, saves: 0,
    hold: false,
    release: () => held?.(),
    call: async (name: string, input: any) => {
      if (name === 'files.locate') return { path: 'notes.md' };
      if (name === 'files.browse') return { path: '', entries: [{ path: 'notes.md', name: 'notes.md', kind: 'file' }], limited: false };
      if (name === 'files.read') return { path: input.path, ...file };
      if (name === 'files.save') {
        if (self.hold) await new Promise<void>((resolve) => (held = resolve));
        if (input.revision !== file.revision) throw new Error('File changed since it was opened; reload before saving');
        self.saves += 1;
        Object.assign(file, { text: input.text, revision: `r${Number(file.revision.slice(1)) + 1}` });
        return { path: input.path, ...file };
      }
      throw new Error(`unexpected ${name}`);
    },
  };
  return self;
}

const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
type Options = { bundle?: any; tab?: any; web?: boolean };
function panel(hosts: Record<string, ReturnType<typeof host>>, id: string, workspaceId: string, { bundle = ui, tab, web = false }: Options = {}) {
  const { FilesPanel, HostRpc, createElement } = bundle;
  tab ??= { state: undefined, setState() {}, setModified() {} };
  const view = createElement(FilesPanel, { host: { id, label: id }, workspaceId, tab, theme, layout: { compact: true, platform: web ? 'web' : 'ios' } });
  return createElement(QueryClientProvider, { client }, createElement(HostRpc, { key: id, call: hosts[id].call }, view));
}
async function mount(hosts: Record<string, ReturnType<typeof host>>, id: string, workspaceId: string, options?: Options) {
  await act(async () => {
    if (tree) tree.update(panel(hosts, id, workspaceId, options));
    else tree = renderer.create(panel(hosts, id, workspaceId, options));
  });
}
async function show(hosts: Record<string, ReturnType<typeof host>>, id: string, workspaceId: string, options?: Options) {
  await mount(hosts, id, workspaceId, options);
  await act(() => sleep(20));
}
async function close() {
  await act(async () => tree.unmount());
  tree = null;
}
const press = (label: string) => act(async () => pressable(tree, label).props.onPress());
const enabled = (label: string) => !labelled(tree, label)[0].props.disabled;
const editable = () => tree.root.find((node: any) => node.props.testID === 'file-editor').props.editable;
const type = (text: string) => act(async () => tree.root.find((node: any) => node.props.testID === 'file-editor').props.onChangeText(text));
const editorText = () => tree.root.find((node: any) => node.props.testID === 'file-editor').props.value;
const status = () => texts(tree).find((text) => text.startsWith('notes.md · '));
const errors = () => texts(tree).filter((text) => text.includes('File changed since it was opened'));
const desktop = () => tree.root.find((node: any) => node.type === 'DesktopEditor');
const UNFINISHED = 'The earlier save has not finished. Check the file before saving again.';
/** The store of cached panel states and running saves on the app's global object. */
const saves = () => (globalThis as any)[Symbol.for('paseo-doc-viewer/file-saves/v1')];
const idle = (): any => ({ folder: '', query: '', mode: 'names', draft: null });
async function open() {
  await press('Open notes.md');
  await act(() => sleep(10));
}

test('a save that finishes after switching host leaves a clean draft at the new revision', async () => {
  const hosts = { A: host(), B: host() };
  // Host B has its own unsaved draft of a file with the same path.
  await show(hosts, 'B', 'w1');
  await open();
  await type('B draft');
  await show(hosts, 'A', 'w1');
  await open();
  await type('A draft');
  hosts.A.hold = true;
  await press('Save');
  await show(hosts, 'B', 'w1');
  assert.equal(editorText(), 'B draft');
  hosts.A.hold = false;
  await act(async () => hosts.A.release());
  await act(() => sleep(10));
  assert.deepEqual(hosts.A.file, { text: 'A draft', revision: 'r2' });

  await show(hosts, 'A', 'w1');
  assert.equal(editorText(), 'A draft');
  assert.equal(status(), 'notes.md · Saved');
  await type('A draft, more');
  await press('Save');
  await act(() => sleep(10));
  assert.deepEqual(errors(), []);
  assert.deepEqual(hosts.A.file, { text: 'A draft, more', revision: 'r3' });

  // Host B's draft is untouched.
  await show(hosts, 'B', 'w1');
  assert.equal(editorText(), 'B draft');
  assert.equal(status(), 'notes.md · Unsaved changes');
  assert.equal(hosts.B.saves, 0);
});

test('a save that finishes after closing the panel leaves a clean draft at the new revision', async () => {
  const hosts = { A: host() };
  await show(hosts, 'A', 'w2');
  await open();
  await type('closing soon');
  hosts.A.hold = true;
  await press('Save');
  await close();
  assert.ok(saves().saving.has('A:w2:browser'));
  hosts.A.hold = false;
  await act(async () => hosts.A.release());
  await act(() => sleep(10));
  assert.ok(!saves().saving.has('A:w2:browser'));

  await show(hosts, 'A', 'w2');
  assert.equal(status(), 'notes.md · Saved');
  await type('closing soon, then more');
  await press('Save');
  await act(() => sleep(10));
  assert.deepEqual(errors(), []);
  assert.deepEqual(hosts.A.file, { text: 'closing soon, then more', revision: 'r3' });
});

test('a save that fails after the panel was left keeps the unsaved draft', async () => {
  const hosts = { A: host() };
  await show(hosts, 'A', 'w3');
  await open();
  await type('mine');
  hosts.A.hold = true;
  await press('Save');
  await close();
  // Someone else saved first.
  Object.assign(hosts.A.file, { text: 'theirs', revision: 'r9' });
  hosts.A.hold = false;
  await act(async () => hosts.A.release());
  await act(() => sleep(10));
  assert.ok(!saves().saving.has('A:w3:browser'));

  await show(hosts, 'A', 'w3');
  assert.equal(editorText(), 'mine');
  assert.equal(status(), 'notes.md · Unsaved changes');
});

test('a panel reopened while its save is still running waits for it, then keeps working', async () => {
  const hosts = { A: host() };
  await show(hosts, 'A', 'w4');
  await open();
  await type('first');
  hosts.A.hold = true;
  await press('Save');
  await close();
  await show(hosts, 'A', 'w4');
  // The same draft is back and stays read-only until the save it started has finished.
  assert.equal(editorText(), 'first');
  assert.equal(editable(), false);
  hosts.A.hold = false;
  await act(async () => hosts.A.release());
  await act(() => sleep(10));
  assert.equal(status(), 'notes.md · Saved');
  await type('first, then more');
  await press('Save');
  await act(() => sleep(10));
  assert.deepEqual(errors(), []);
  assert.deepEqual(hosts.A.file, { text: 'first, then more', revision: 'r3' });
  await close();
  await show(hosts, 'A', 'w4');
  assert.equal(editorText(), 'first, then more');
  assert.equal(status(), 'notes.md · Saved');
});

test('a late save does not replace a different draft of the same file', async () => {
  const hosts = { A: host() };
  await show(hosts, 'A', 'w5');
  await open();
  await type('saved text');
  hosts.A.hold = true;
  await press('Save');
  await close();
  // Reopen, discard the restored draft while it waits for the save, and start a different one from the file as it still is.
  await show(hosts, 'A', 'w5');
  assert.equal(editable(), false);
  await press('Back to files');
  await press('Discard changes');
  await act(() => sleep(10));
  await open();
  assert.equal(editorText(), 'old text');
  assert.equal(editable(), true);
  await type('another draft');
  hosts.A.hold = false;
  await act(async () => hosts.A.release());
  await act(() => sleep(10));
  assert.deepEqual(hosts.A.file, { text: 'saved text', revision: 'r2' });
  assert.equal(editorText(), 'another draft');
  assert.equal(status(), 'notes.md · Unsaved changes');
  await close();
  await show(hosts, 'A', 'w5');
  assert.equal(editorText(), 'another draft');
  assert.equal(status(), 'notes.md · Unsaved changes');
});

test('a late save does not replace a different draft kept for the closed panel', async () => {
  const hosts = { A: host() };
  await show(hosts, 'A', 'w6');
  await open();
  await type('saved text');
  hosts.A.hold = true;
  await press('Save');
  await close();
  await show(hosts, 'A', 'w6');
  assert.equal(editable(), false);
  await press('Back to files');
  await press('Discard changes');
  await act(() => sleep(10));
  await open();
  await type('another draft');
  await close();
  hosts.A.hold = false;
  await act(async () => hosts.A.release());
  await act(() => sleep(10));
  await show(hosts, 'A', 'w6');
  assert.equal(editorText(), 'another draft');
  assert.equal(status(), 'notes.md · Unsaved changes');
});

test('a panel waiting for an earlier save can still be left, and shows that save failing', async () => {
  const hosts = { A: host() };
  await show(hosts, 'A', 'w7');
  await open();
  await type('mine');
  hosts.A.hold = true;
  await press('Save');
  await close();
  await show(hosts, 'A', 'w7');
  assert.equal(editable(), false);
  // Back and Discard stay usable while it waits.
  await press('Back to files');
  assert.ok(enabled('Discard changes'));
  await press('Keep editing');
  // Someone else saved first.
  Object.assign(hosts.A.file, { text: 'theirs', revision: 'r9' });
  hosts.A.hold = false;
  await act(async () => hosts.A.release());
  await act(() => sleep(10));
  assert.equal(errors().length, 1);
  assert.equal(editable(), true);
  assert.equal(editorText(), 'mine');
  assert.equal(status(), 'notes.md · Unsaved changes');
});

test('a panel stops waiting for an earlier save that never finishes', async () => {
  const hosts = { A: host() };
  await show(hosts, 'A', 'w8');
  await open();
  await type('stuck');
  hosts.A.hold = true;
  await press('Save');
  await close();
  // The connection dropped: this save will not settle for a long time.
  mock.timers.enable({ apis: ['setTimeout'] });
  await mount(hosts, 'A', 'w8');
  assert.equal(editable(), false);
  await act(async () => mock.timers.tick(29_999));
  assert.equal(editable(), false);
  await act(async () => mock.timers.tick(1));
  assert.equal(editable(), true);
  assert.ok(texts(tree).includes(UNFINISHED));
  assert.ok(!saves().saving.has('A:w8:browser'));
  assert.equal(editorText(), 'stuck');
  assert.equal(status(), 'notes.md · Unsaved changes');
  await type('stuck, then newer');
  mock.timers.reset();
  // The save is no longer waited for.
  await close();
  await show(hosts, 'A', 'w8');
  assert.equal(editable(), true);
  assert.equal(editorText(), 'stuck, then newer');
  // When it does finish, the newer draft is kept.
  hosts.A.hold = false;
  await act(async () => hosts.A.release());
  await act(() => sleep(10));
  assert.deepEqual(hosts.A.file, { text: 'stuck', revision: 'r2' });
  assert.equal(editorText(), 'stuck, then newer');
  assert.equal(status(), 'notes.md · Unsaved changes');
  await close();
  await show(hosts, 'A', 'w8');
  assert.equal(editorText(), 'stuck, then newer');
  assert.equal(status(), 'notes.md · Unsaved changes');
});

test('a save that finishes after the panel was left still counts once the bundle is loaded again', async () => {
  const hosts = { A: host() };
  // Paseo keeps the tab's state across a reconnect.
  const tab = { state: undefined as unknown, setState(state: unknown) { tab.state = state; }, setModified() {} };
  await show(hosts, 'A', 'w9', { tab });
  await open();
  await type('before reconnect');
  hosts.A.hold = true;
  await press('Save');
  await close();
  hosts.A.hold = false;
  await act(async () => hosts.A.release());
  await act(() => sleep(10));
  await show(hosts, 'A', 'w9', { bundle: reloaded, tab });
  assert.equal(editorText(), 'before reconnect');
  assert.equal(status(), 'notes.md · Saved');

  // A save still running when the bundle is loaded again is waited for.
  await type('during reconnect');
  hosts.A.hold = true;
  await press('Save');
  await close();
  await show(hosts, 'A', 'w9', { tab });
  assert.equal(editable(), false);
  hosts.A.hold = false;
  await act(async () => hosts.A.release());
  await act(() => sleep(10));
  assert.equal(status(), 'notes.md · Saved');
  await type('after reconnect');
  await press('Save');
  await act(() => sleep(10));
  assert.deepEqual(errors(), []);
  assert.deepEqual(hosts.A.file, { text: 'after reconnect', revision: 'r4' });
});

test('a bundle loaded beside a malformed saves store uses a fresh one', async () => {
  const key = Symbol.for('paseo-doc-viewer/file-saves/v1');
  const kept = (globalThis as any)[key];
  (globalThis as any)[key] = { memory: {}, saving: [] };
  try {
    const bundle = await loadComponents('files-save-malformed', source);
    const hosts = { A: host() };
    await show(hosts, 'A', 'w10', { bundle });
    await open();
    await type('fresh store');
    await press('Save');
    await act(() => sleep(10));
    assert.deepEqual(errors(), []);
    assert.equal(status(), 'notes.md · Saved');
    assert.ok((globalThis as any)[key].memory instanceof Map);
  } finally {
    (globalThis as any)[key] = kept;
  }
});

test('a file panel given another host shows that host\'s file, not a draft waiting on this one', async () => {
  const hosts = { A: host(), B: host() };
  hosts.B.file.text = 'B text';
  // Each host's files.locate result stays cached, so the panel can switch host without loading.
  const files = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const tab = { state: undefined, setState() {}, setModified() {} };
  const filePanel = (id: 'A' | 'B') => {
    const { FileEditorPanel, HostRpc, createElement } = ui;
    const view = createElement(FileEditorPanel, { host: { id, label: id }, workspaceId: 'w11', file: { path: '/w11/notes.md' }, tab, theme, layout: { compact: true, platform: 'ios' } });
    return createElement(QueryClientProvider, { client: files }, createElement(HostRpc, { call: hosts[id].call }, view));
  };
  async function showFile(id: 'A' | 'B') {
    await act(async () => {
      if (tree) tree.update(filePanel(id));
      else tree = renderer.create(filePanel(id));
    });
    await act(() => sleep(20));
  }
  try {
    await showFile('B');
    assert.equal(editorText(), 'B text');
    await close();
    await showFile('A');
    await type('A draft');
    hosts.A.hold = true;
    await press('Save');
    await close();
    await showFile('A');
    assert.equal(editable(), false);
    // Paseo hands the same panel the other host.
    await showFile('B');
    assert.equal(editorText(), 'B text');
    assert.equal(editable(), true);
    hosts.A.hold = false;
    await act(async () => hosts.A.release());
    await act(() => sleep(10));
    assert.deepEqual(hosts.A.file, { text: 'A draft', revision: 'r2' });
    assert.equal(editorText(), 'B text');
  } finally {
    files.clear();
  }
});

test('a malformed cached panel state is ignored in favour of the tab state', async () => {
  const hosts = { A: host() };
  saves().memory.set('A:w12:browser', { draft: { path: 'notes.md' } });
  const draft = { path: 'notes.md', text: 'from the tab', baseText: 'old text', revision: 'r1' };
  const tab = { state: { ...idle(), workspaceId: 'w12', draft }, setState() {}, setModified() {} };
  await show(hosts, 'A', 'w12', { tab });
  assert.equal(editorText(), 'from the tab');
  assert.equal(status(), 'notes.md · Unsaved changes');
});

test('a cached draft longer than the save limit is kept, so it can be trimmed', async () => {
  const hosts = { A: host() };
  const long = 'x'.repeat(524_289);
  saves().memory.set('A:w13:browser', { ...idle(), workspaceId: 'w13', folder: 'docs', draft: { path: 'notes.md', text: long, baseText: 'old text', revision: 'r1' } });
  await show(hosts, 'A', 'w13');
  assert.equal(editorText().length, long.length);
  assert.equal(status(), 'notes.md · Unsaved changes');
});

test('a malformed save record is not waited for', async () => {
  const hosts = { A: host() };
  const draft = { path: 'notes.md', text: 'mine', baseText: 'old text', revision: 'r1' };
  saves().memory.set('A:w13:browser', { ...idle(), workspaceId: 'w13', draft });
  saves().saving.set('A:w13:browser', { draft: { path: 'notes.md', text: 'mine', revision: 'r1' }, result: {} });
  await show(hosts, 'A', 'w13');
  assert.equal(editorText(), 'mine');
  assert.equal(editable(), true);
  await press('Save');
  await act(() => sleep(10));
  assert.equal(status(), 'notes.md · Saved');
});

test('the panel cache keeps a draft whose save is still running', async () => {
  const hosts = { A: host() };
  await show(hosts, 'A', 'w14');
  await open();
  await type('in flight');
  hosts.A.hold = true;
  await press('Save');
  await close();
  // Fifty newer panel states, then a panel write that trims the cache to its limit.
  for (let i = 0; i < 50; i += 1) saves().memory.set(`A:other-${i}:browser`, { ...idle(), workspaceId: `other-${i}` });
  await show(hosts, 'A', 'w14-other');
  await close();
  assert.ok(saves().memory.size <= 51);
  assert.ok(saves().memory.has('A:w14:browser'));
  hosts.A.hold = false;
  await act(async () => hosts.A.release());
  await act(() => sleep(10));
  await show(hosts, 'A', 'w14');
  assert.equal(editorText(), 'in flight');
  assert.equal(status(), 'notes.md · Saved');
});

test('leaving a clean draft that waits for an earlier save ends the wait', async () => {
  const hosts = { A: host() };
  await show(hosts, 'A', 'w15', { web: true });
  await open();
  hosts.A.hold = true;
  // Cmd-S in the desktop editor saves a clean draft too.
  await act(async () => desktop().props.onSave());
  await close();
  await show(hosts, 'A', 'w15', { web: true });
  assert.equal(desktop().props.readOnly, true);
  await press('Back to files');
  await open();
  assert.equal(desktop().props.readOnly, false);
  hosts.A.hold = false;
  await act(async () => hosts.A.release());
  await act(() => sleep(10));
});
