import { Linking, Platform } from "react-native";
import React, { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { PluginTheme } from "@getpaseo/plugin";

declare const window: { open(url: string, target: string, features: string): unknown };

export async function openExternal(url: string): Promise<void> {
  if (Platform.OS === "web") {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  await Linking.openURL(url);
}

export type EditorSelection = { start: number; end: number };
export type EditorHandle = { focus(): void; undo(): void; redo(): void };

export type DesktopEditorProps = {
  value: string;
  selection: EditorSelection;
  onChange(text: string): void;
  onSelectionChange(selection: EditorSelection): void;
  onSave(): void;
  language: string;
  theme: PluginTheme;
  readOnly: boolean;
  vimMode: boolean;
  onVimMode?(mode: string): void;
};

// Kept per CM instance: the Vim package's ex-command registry is process-wide.
const saveHandlers = new WeakMap<object, () => void>();
let writeCommandInstalled = false;

function lineSeparator(text: string): string {
  if (text.includes("\r\n")) return "\r\n";
  if (text.includes("\r")) return "\r";
  return "\n";
}

function toEditorOffset(rawOffset: number, text: string): number {
  const limit = Math.max(0, Math.min(rawOffset, text.length));
  let normalized = 0;
  for (let index = 0; index < limit; index++) {
    if (text[index] === "\r" && text[index + 1] === "\n") {
      normalized++;
      index++;
    } else {
      normalized++;
    }
  }
  return normalized;
}

function toSourceOffset(editorOffset: number, text: string): number {
  const target = Math.max(0, editorOffset);
  let raw = 0;
  let normalized = 0;
  while (raw < text.length && normalized < target) {
    if (text[raw] === "\r" && text[raw + 1] === "\n") raw += 2;
    else raw++;
    normalized++;
  }
  return raw;
}

function normalizeSelection(selection: EditorSelection, text: string) {
  return {
    anchor: toEditorOffset(selection.start, text),
    head: toEditorOffset(selection.end, text),
  };
}

function currentSelection(view: any, text: string): EditorSelection {
  const range = view.state.selection.main;
  return {
    start: toSourceOffset(Math.min(range.anchor, range.head), text),
    end: toSourceOffset(Math.max(range.anchor, range.head), text),
  };
}

function languageExtension(language: string, modules: Record<string, any>): unknown[] {
  const normalized = language.toLowerCase().replace(/^\./, "");
  if (["md", "markdown", "mdown", "mkd"].includes(normalized)) return [modules.markdown()];
  if (["yaml", "yml"].includes(normalized)) return [modules.yaml()];
  if (normalized === "json" || normalized === "jsonc") return [modules.json()];
  if (["js", "javascript", "jsx", "ts", "typescript", "tsx"].includes(normalized)) {
    return [modules.javascript({ typescript: ["ts", "typescript", "tsx"].includes(normalized), jsx: ["jsx", "tsx"].includes(normalized) })];
  }
  if (normalized === "py" || normalized === "python") return [modules.python()];
  return [];
}

export const DesktopEditor = forwardRef<EditorHandle, DesktopEditorProps>(function DesktopEditor(props, forwardedRef) {
  const hostRef = useRef<any>(null);
  const viewRef = useRef<any>(null);
  const cmRef = useRef<any>(null);
  const modulesRef = useRef<any>(null);
  const compartmentsRef = useRef<any>(null);
  const latestRef = useRef(props);
  const vimEnabledRef = useRef(props.vimMode);
  const lastVimModeRef = useRef("");
  const modeListenerCleanup = useRef<(() => void) | null>(null);
  latestRef.current = props;
  vimEnabledRef.current = props.vimMode;

  function bindVimMode(cm: any, editorView: any, vimPackage: any) {
    modeListenerCleanup.current?.();
    modeListenerCleanup.current = null;
    if (!cm) return;
    const changed = () => notifyVimMode(editorView, vimPackage, vimEnabledRef.current, lastVimModeRef, latestRef);
    cm.on("vim-mode-change", changed);
    modeListenerCleanup.current = () => cm.off("vim-mode-change", changed);
  }

  useImperativeHandle(forwardedRef, () => ({
    focus: () => viewRef.current?.focus(),
    undo: () => { const modules = modulesRef.current; const view = viewRef.current; if (modules && view) modules.undo(view); },
    redo: () => { const modules = modulesRef.current; const view = viewRef.current; if (modules && view) modules.redo(view); },
  }), []);

  useEffect(() => {
    if (Platform.OS !== "web" || !hostRef.current) return;

    // Load DOM-dependent modules only after the platform guard, so importing this module on native is safe.
    const codemirror = require("codemirror");
    const state = require("@codemirror/state");
    const view = require("@codemirror/view");
    const commands = require("@codemirror/commands");
    const vimPackage = require("@replit/codemirror-vim");
    const modules = {
      EditorState: state.EditorState,
      EditorView: view.EditorView,
      markdown: require("@codemirror/lang-markdown").markdown,
      yaml: require("@codemirror/lang-yaml").yaml,
      json: require("@codemirror/lang-json").json,
      javascript: require("@codemirror/lang-javascript").javascript,
      python: require("@codemirror/lang-python").python,
      undo: commands.undo,
      redo: commands.redo,
    };
    modulesRef.current = modules;

    const vimCompartment = new state.Compartment();
    const lineSeparatorCompartment = new state.Compartment();
    const languageCompartment = new state.Compartment();
    const themeCompartment = new state.Compartment();
    const readOnlyCompartment = new state.Compartment();
    const lineBreak = lineSeparator(latestRef.current.value);
    const initialSelection = normalizeSelection(latestRef.current.selection, latestRef.current.value);

    if (!writeCommandInstalled) {
      vimPackage.Vim.defineEx("write", "w", (cm: object, params: { argString?: string }) => {
        // This command can only save the current, already-open file; it cannot accept a path or host command.
        if (!params.argString?.trim()) saveHandlers.get(cm)?.();
      });
      writeCommandInstalled = true;
    }

    const editorView = new view.EditorView({
      state: state.EditorState.create({
        doc: latestRef.current.value,
        selection: initialSelection,
        extensions: [
          lineSeparatorCompartment.of(state.EditorState.lineSeparator.of(lineBreak)),
          vimCompartment.of(latestRef.current.vimMode ? vimPackage.vim() : []),
          codemirror.basicSetup,
          view.EditorView.lineWrapping,
          view.EditorView.contentAttributes.of({ "aria-label": "File contents" }),
          languageCompartment.of(languageExtension(latestRef.current.language, modules)),
          themeCompartment.of(themeExtension(view.EditorView, latestRef.current.theme)),
          readOnlyCompartment.of(readOnlyExtension(state.EditorState, view.EditorView, latestRef.current.readOnly)),
          view.EditorView.updateListener.of((update: any) => {
            const current = latestRef.current;
            const value = update.state.sliceDoc();
            if (update.docChanged) current.onChange(value);
            if (update.docChanged || update.selectionSet) current.onSelectionChange(currentSelection(update.view, value));
            notifyVimMode(update.view, vimPackage, vimEnabledRef.current, lastVimModeRef, latestRef);
          }),
        ],
      }),
      parent: hostRef.current,
    });
    viewRef.current = editorView;
    compartmentsRef.current = { vimCompartment, lineSeparatorCompartment, languageCompartment, themeCompartment, readOnlyCompartment, lineBreak };
    const cm = vimPackage.getCM(editorView);
    cmRef.current = cm;
    if (cm) saveHandlers.set(cm, () => { if (!latestRef.current.readOnly) latestRef.current.onSave(); });
    bindVimMode(cm, editorView, vimPackage);
    notifyVimMode(editorView, vimPackage, latestRef.current.vimMode, lastVimModeRef, latestRef);

    const saveShortcut = (event: any) => {
      if ((event.metaKey || event.ctrlKey) && String(event.key).toLowerCase() === "s") {
        event.preventDefault();
        event.stopPropagation();
        if (!latestRef.current.readOnly) latestRef.current.onSave();
      }
    };
    editorView.dom.addEventListener("keydown", saveShortcut, true);

    return () => {
      modeListenerCleanup.current?.();
      modeListenerCleanup.current = null;
      editorView.dom.removeEventListener("keydown", saveShortcut, true);
      if (cm) saveHandlers.delete(cm);
      editorView.destroy();
      if (cmRef.current) saveHandlers.delete(cmRef.current);
      cmRef.current = null;
      if (viewRef.current === editorView) viewRef.current = null;
      modulesRef.current = null;
      compartmentsRef.current = null;
    };
  }, []);

  useEffect(() => {
    const editorView = viewRef.current;
    const compartments = compartmentsRef.current;
    const modules = modulesRef.current;
    if (!editorView || !compartments || !modules) return;
    const currentText = editorView.state.sliceDoc();
    const nextText = latestRef.current.value;
    if (currentText !== nextText) {
      const selection = normalizeSelection(latestRef.current.selection, nextText);
      const nextLineBreak = lineSeparator(nextText);
      if (nextLineBreak !== compartments.lineBreak) {
        editorView.dispatch({ effects: compartments.lineSeparatorCompartment.reconfigure(modules.EditorState.lineSeparator.of(nextLineBreak)) });
        compartments.lineBreak = nextLineBreak;
      }
      editorView.dispatch({
        changes: { from: 0, to: editorView.state.doc.length, insert: nextText },
        selection,
        scrollIntoView: true,
      });
    }
  }, [props.value]);

  useEffect(() => {
    const editorView = viewRef.current;
    if (!editorView) return;
    const text = editorView.state.sliceDoc();
    const selection = normalizeSelection(props.selection, text);
    const current = editorView.state.selection.main;
    const currentStart = Math.min(current.anchor, current.head);
    const currentEnd = Math.max(current.anchor, current.head);
    const wantedStart = Math.min(selection.anchor, selection.head);
    const wantedEnd = Math.max(selection.anchor, selection.head);
    if (currentStart !== wantedStart || currentEnd !== wantedEnd) {
      editorView.dispatch({ selection, scrollIntoView: true });
    }
  }, [props.selection.start, props.selection.end]);

  useEffect(() => {
    const editorView = viewRef.current;
    const compartments = compartmentsRef.current;
    const modules = modulesRef.current;
    if (!editorView || !compartments || !modules) return;
    editorView.dispatch({ effects: compartments.languageCompartment.reconfigure(languageExtension(props.language, modules)) });
  }, [props.language]);

  useEffect(() => {
    const editorView = viewRef.current;
    const compartments = compartmentsRef.current;
    const modules = modulesRef.current;
    if (!editorView || !compartments || !modules) return;
    editorView.dispatch({ effects: compartments.themeCompartment.reconfigure(themeExtension(modulesRef.current.EditorView, props.theme)) });
  }, [props.theme]);

  useEffect(() => {
    const editorView = viewRef.current;
    const compartments = compartmentsRef.current;
    if (!editorView || !compartments) return;
    const modules = modulesRef.current;
    editorView.dispatch({ effects: compartments.readOnlyCompartment.reconfigure(readOnlyExtension(modules.EditorState, modules.EditorView, props.readOnly)) });
  }, [props.readOnly]);

  useEffect(() => {
    const editorView = viewRef.current;
    const compartments = compartmentsRef.current;
    if (!editorView || !compartments) return;
    const vimPackage = require("@replit/codemirror-vim");
    editorView.dispatch({ effects: compartments.vimCompartment.reconfigure(props.vimMode ? vimPackage.vim() : []) });
    const cm = vimPackage.getCM(editorView);
    if (cmRef.current && cmRef.current !== cm) saveHandlers.delete(cmRef.current);
    cmRef.current = cm;
    if (cm) saveHandlers.set(cm, () => { if (!latestRef.current.readOnly) latestRef.current.onSave(); });
    bindVimMode(cm, editorView, vimPackage);
    notifyVimMode(editorView, vimPackage, props.vimMode, lastVimModeRef, latestRef, true);
  }, [props.vimMode]);

  if (Platform.OS !== "web") return null;
  return React.createElement("div", {
    ref: hostRef,
    "data-testid": "desktop-code-editor",
    style: { minHeight: 180, height: "100%", width: "100%", overflow: "hidden", background: props.theme.colors.surface0, color: props.theme.colors.foreground },
  });
});

function notifyVimMode(view: any, vimPackage: any, enabled: boolean, lastModeRef: { current: string }, latestRef: { current: DesktopEditorProps }, force = false) {
  const cm = vimPackage.getCM(view);
  const mode = enabled ? String(cm?.state.vim?.mode ?? "normal").toLowerCase() : "off";
  if (force || mode !== lastModeRef.current) {
    lastModeRef.current = mode;
    latestRef.current.onVimMode?.(mode);
  }
}

function themeExtension(EditorView: any, theme: PluginTheme) {
  const colors = theme.colors;
  return EditorView.theme({
    "&": { height: "100%", fontSize: "14px", backgroundColor: colors.surface0, color: colors.foreground },
    ".cm-scroller": { overflow: "auto", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", lineHeight: "1.6" },
    ".cm-gutters": { backgroundColor: colors.surface1, color: colors.foregroundMuted, borderRight: `1px solid ${colors.border}` },
    ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: colors.surface2 },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: colors.accent },
    ".cm-selectionBackground, .cm-focused .cm-selectionBackground": { backgroundColor: `color-mix(in srgb, ${colors.accent} 32%, transparent)` },
    ".cm-content": { caretColor: colors.accent },
    "&.cm-focused": { outline: "none" },
    ".cm-vim-panel": { color: colors.foregroundMuted, backgroundColor: colors.surface1, borderTop: `1px solid ${colors.border}`, padding: "3px 8px" },
  }, { dark: true });
}

function readOnlyExtension(EditorState: any, EditorView: any, readOnly: boolean) {
  return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)];
}
