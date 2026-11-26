// Checks the global store that keeps a note being edited: it is shared by every load of the bundle
// in an app session, and a store of any other shape is replaced instead of being used.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { labelled, loadComponents, pressable, sleep, theme } from './component-harness';

const source = `
  export { ReviewScreen } from "./client/doc-viewer/review-screen";
  export { reviewDrafts, reviewScope } from "./client/doc-viewer/review-draft";`;
const EDITING_KEY = Symbol.for('paseo-doc-viewer/review-editing/v1');
const first = await loadComponents('review-store-first', source);
// The host evaluates the bundle again when it reconnects.
const second = await loadComponents('review-store-second', source);
const { act, renderer, QueryClient, QueryClientProvider } = first;

let tree: any = null;
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  tree = null;
});

const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
const call = async (name: string) => (name === 'doc.open' ? { revision: 'r1' } : { pins: [] });
async function show(bundle: any, workspaceId: string) {
  const { ReviewScreen, HostRpc, createElement } = bundle;
  const view = createElement(ReviewScreen, { host: { id: 'A', label: 'A' }, theme, layout: { compact: true, platform: 'ios' }, params: { workspaceId } });
  await act(async () => {
    tree = renderer.create(createElement(QueryClientProvider, { client }, createElement(HostRpc, { call }, view)));
  });
  await act(() => sleep(10));
}
async function close() {
  await act(async () => tree.unmount());
  tree = null;
}
const editor = () => labelled(tree, 'Edit note text')[0];
const press = (label: string) => act(async () => pressable(tree, label).props.onPress());
const type = (text: string) => act(async () => editor().props.onChangeText(text));
const note = (bundle: any, workspaceId: string, text: string) =>
  bundle.reviewDrafts.addNote(bundle.reviewScope('A', workspaceId), { path: 'report.pdf', revision: 'r1', page: 0, unit: 'page', text });

/** Edits a note, closes the screen, and checks the edit is back when it reopens. */
async function editSurvivesClose(bundle: any, workspaceId: string) {
  note(bundle, workspaceId, 'original');
  await show(bundle, workspaceId);
  await press('Edit note on page 1');
  await type('kept');
  await close();
  await show(bundle, workspaceId);
  assert.equal(editor()?.props.value, 'kept');
}
function assertPlainStore() {
  const store = (globalThis as any)[EDITING_KEY];
  assert.ok(store.edits instanceof Map);
  assert.ok(store.listeners instanceof Set);
}

test('an edit in progress comes back after the bundle is loaded again', async () => {
  note(first, 'w1', 'original');
  await show(first, 'w1');
  await press('Edit note on page 1');
  await type('edited before reconnect');
  await close();
  await show(second, 'w1');
  assert.equal(editor()?.props.value, 'edited before reconnect');
  await press('Save');
  assert.deepEqual(first.reviewDrafts.get(first.reviewScope('A', 'w1')).notes.map((each: any) => each.text), ['edited before reconnect']);
});

for (const [label, store] of [
  ['that is malformed', { edits: {}, listeners: [] }],
  // The shape an earlier draft of this change stored: an object of methods.
  ['of methods', { get: () => undefined, set() {}, subscribe: () => () => {} }],
] as const) {
  test(`an edits store ${label} is replaced with a working one`, async () => {
    const kept = (globalThis as any)[EDITING_KEY];
    (globalThis as any)[EDITING_KEY] = store;
    try {
      const bundle = await loadComponents(`review-store-${label.replaceAll(' ', '-')}`, source);
      await editSurvivesClose(bundle, `w-${label}`);
      assertPlainStore();
    } finally {
      (globalThis as any)[EDITING_KEY] = kept;
    }
  });
}

test('a kept edit that is not an id and text is ignored', async () => {
  const kept = note(first, 'w2', 'original');
  (globalThis as any)[EDITING_KEY].edits.set(first.reviewScope('A', 'w2'), { id: kept.id, text: 42 });
  await show(first, 'w2');
  assert.equal(editor(), undefined);
  await press('Edit note on page 1');
  assert.equal(editor()?.props.value, 'original');
});
