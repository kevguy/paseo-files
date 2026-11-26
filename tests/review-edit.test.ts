// Mounts the real review screen and checks that a note being edited survives a host switch or a close.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { labelled, loadComponents, pressable, sleep, texts, theme } from './component-harness';

const source = `
  export { ReviewScreen } from "./client/doc-viewer/review-screen";
  export { createReviewDrafts, reviewDrafts, reviewScope } from "./client/doc-viewer/review-draft";`;
const fresh = await loadComponents('review-edit', source);
// The drafts store is shared on the app's global object. A bundle from 0.1.5 may have created it
// earlier in this app session, with only these methods.
const DRAFTS_KEY = Symbol.for('paseo-doc-viewer/review-drafts/v1');
const OLD_METHODS = ['get', 'composing', 'setComposing', 'subscribe', 'addNote', 'editNote', 'removeNote', 'removeNotes', 'attachImage', 'detachImage', 'clear'];
const made = fresh.createReviewDrafts();
const oldStore = Object.fromEntries(OLD_METHODS.map((name) => [name, made[name]]));
(globalThis as any)[DRAFTS_KEY] = oldStore;
const old = await loadComponents('review-edit-old-store', source);

test('a drafts store left by an older bundle is the one the screen uses', () => {
  assert.equal(old.reviewDrafts, oldStore);
  assert.notEqual(fresh.reviewDrafts, oldStore);
});

for (const [label, ui] of [['', fresh], [' (drafts store from an older bundle)', old]] as const) {
  const { ReviewScreen, reviewDrafts, reviewScope, HostRpc, setTestAgents, createElement, act, renderer, QueryClient, QueryClientProvider } = ui;
  const w = (id: string) => `${id}${label ? '-old' : ''}`;

  let tree: any = null;
  afterEach(async () => {
    if (tree) await act(async () => tree.unmount());
    tree = null;
  });

  const clients = new Map<string, any>();
  const call = async (name: string) => {
    if (name === 'doc.open') return { revision: 'r1' };
    return { pins: [] };
  };
  const screen = (host: string, workspaceId: string) => {
    const client = clients.get(host) ?? new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    clients.set(host, client);
    const view = createElement(ReviewScreen, { key: host, host: { id: host, label: host }, theme, layout: { compact: true, platform: 'ios' }, params: { workspaceId: w(workspaceId) } });
    return createElement(QueryClientProvider, { client }, createElement(HostRpc, { call }, view));
  };
  /** Shows the review screen for this host; Paseo mounts a new screen for each host. */
  async function show(host: string, workspaceId: string) {
    await act(async () => {
      if (tree) tree.update(screen(host, workspaceId));
      else tree = renderer.create(screen(host, workspaceId));
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
  const scope = (host: string, workspaceId: string) => reviewScope(host, w(workspaceId));
  const note = (host: string, workspaceId: string, text: string) =>
    reviewDrafts.addNote(scope(host, workspaceId), { path: 'report.pdf', revision: 'r1', page: 0, unit: 'page', text });

  test(`an edit in progress comes back after switching host and back${label}`, async () => {
    note('A', 'w1', 'original on A');
    note('B', 'w1', 'original on B');
    await show('A', 'w1');
    await press('Edit note on page 1');
    await type('changed on A');
    await show('B', 'w1');
    // Host B has a note too, and it is not being edited.
    assert.equal(editor(), undefined);
    assert.ok(texts(tree).includes('original on B'));
    assert.ok(!texts(tree).includes('changed on A'));
    await show('A', 'w1');
    assert.equal(editor()?.props.value, 'changed on A');
    await press('Save');
    assert.deepEqual(reviewDrafts.get(scope('A', 'w1')).notes.map((each: any) => each.text), ['changed on A']);
    assert.deepEqual(reviewDrafts.get(scope('B', 'w1')).notes.map((each: any) => each.text), ['original on B']);
    // Saved, so reopening shows the note, not the editor.
    await close();
    await show('A', 'w1');
    assert.equal(editor(), undefined);
  });

  test(`an edit in progress comes back after closing and reopening the screen${label}`, async () => {
    note('A', 'w2', 'first draft');
    await show('A', 'w2');
    await press('Edit note on page 1');
    await type('better wording');
    await close();
    await show('A', 'w2');
    assert.equal(editor()?.props.value, 'better wording');
    // Cancel drops it, and the note keeps its text.
    await press('Cancel');
    await close();
    await show('A', 'w2');
    assert.equal(editor(), undefined);
    assert.deepEqual(reviewDrafts.get(scope('A', 'w2')).notes.map((each: any) => each.text), ['first draft']);
  });

  test(`an edit in progress is not shown for another workspace on the same host${label}`, async () => {
    note('A', 'w3', 'in w3');
    note('A', 'w4', 'in w4');
    await show('A', 'w3');
    await press('Edit note on page 1');
    await type('editing w3');
    await close();
    await show('A', 'w4');
    assert.equal(editor(), undefined);
    assert.ok(texts(tree).includes('in w4'));
  });

  test(`an edit of a note that was removed meanwhile is dropped${label}`, async () => {
    // An idle agent in this workspace, so Send is enabled unless something blocks it.
    setTestAgents([{ id: 'agent-1', workspaceId: w('w5'), provider: 'claude', title: 'Helper', status: 'idle', updatedAt: '2026-11-26T00:00:00.000Z', pendingPermissions: [] }]);
    const kept = note('A', 'w5', 'will go');
    await show('A', 'w5');
    await press('Edit note on page 1');
    await type('edited');
    await close();
    reviewDrafts.removeNote(scope('A', 'w5'), kept.id);
    note('A', 'w5', 'new note');
    await show('A', 'w5');
    assert.equal(editor(), undefined);
    assert.ok(texts(tree).includes('new note'));
    assert.equal(labelled(tree, 'Edit note on page 1').length, 1);
    // The kept edit of the removed note does not block Send.
    pressable(tree, 'Send review to Helper');
    setTestAgents([]);
  });
}
