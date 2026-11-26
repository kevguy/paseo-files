// Bundles real client components with small React Native and Paseo stand-ins, so a test can mount
// them with react-test-renderer, switch host or close the screen, and read what is on screen.
import { mkdirSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build, type Plugin } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));

const hostComponents = ['ActivityIndicator', 'FlatList', 'Image', 'KeyboardAvoidingView', 'Pressable', 'ScrollView', 'Text', 'TextInput', 'View'];
const stubs: Record<string, string> = {
  'react-native': `${hostComponents.map((name) => `export const ${name} = ${JSON.stringify(name)};`).join('\n')}
    export const Platform = { OS: "ios", select: (options) => options.ios ?? options.native ?? options.default };
    const size = { width: 400, height: 800, scale: 1, fontScale: 1 };
    export const Dimensions = { get: () => size, addEventListener: () => ({ remove() {} }) };
    export const useWindowDimensions = () => size;
    export const TurboModuleRegistry = { get: () => null };
    export const Keyboard = { addListener: () => ({ remove() {} }) };
    export const StyleSheet = { create: (styles) => styles, flatten: (style) => style, hairlineWidth: 1 };`,
  '@getpaseo/plugin/client/react-native': `export { ScrollView, TextInput, FlatList } from "react-native";
    export const Icon = "Icon";
    export const copyText = async () => {};
    const toast = { show() {}, error() {} };
    export const useToast = () => toast;`,
  '@getpaseo/plugin/client/ui': 'export const copyText = async () => {};',
  // RPC hooks call the host of the nearest HostRpc, as Paseo binds them to the mounted screen's host.
  '@getpaseo/plugin/client': `import { createContext, createElement, useContext, useMemo } from "react";
    const Host = createContext(null);
    export function HostRpc({ call, children }) { return createElement(Host.Provider, { value: call }, children); }
    export function useRpc(rpc) { const call = useContext(Host); return useMemo(() => (input) => call(rpc.name, input), [call, rpc.name]); }
    // The agents a review can be sent to; a test sets them with setTestAgents.
    let agents = [];
    export function setTestAgents(list) { agents = list; }
    const paseo = { agents: { list: async () => ({ entries: agents.map((agent) => ({ agent })) }) } };
    export const usePaseo = () => paseo;`,
  // Not under test, and they need a browser or the full viewer. The desktop editor is a plain element,
  // so a test can read its props and call onSave as Cmd-S would.
  'client/web': `import { createElement } from "react";
    export const DesktopEditor = ({ ref, ...props }) => createElement("DesktopEditor", props);`,
  'client/doc-viewer/document-screen': 'export const DocumentScreen = () => null;',
};

const stubPlugin: Plugin = {
  name: 'stubs',
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      const id = args.path.startsWith('.') ? relative(root, resolve(args.resolveDir, args.path)).split(sep).join('/') : args.path;
      return id in stubs ? { path: id, namespace: 'stub' } : undefined;
    });
    build.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: stubs[args.path], loader: 'js', resolveDir: root }));
  },
};

/** Bundles `source` (ES module text resolved from the repository root) and loads it. React and the renderer are shared. */
export async function loadComponents(name: string, source: string): Promise<any> {
  const out = `${root}.validation/component-tests`;
  mkdirSync(out, { recursive: true });
  await build({
    stdin: {
      contents: `${source}
        export { HostRpc, setTestAgents } from "@getpaseo/plugin/client";
        export { createElement, act } from "react"; export { default as renderer } from "react-test-renderer";
        export { QueryClient, QueryClientProvider } from "@tanstack/react-query";`,
      resolveDir: root,
      loader: 'ts',
    },
    bundle: true, format: 'cjs', platform: 'node', outfile: `${out}/${name}.cjs`, logLevel: 'error', jsx: 'automatic',
    external: ['react', 'react/jsx-runtime', 'react-test-renderer', '@tanstack/react-query'],
    define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [stubPlugin],
  });
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const report = console.error;
  console.error = (...args) => void (String(args[0]).includes('react-test-renderer is deprecated') || report(...args));
  return createRequire(import.meta.url)(`${out}/${name}.cjs`);
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export const theme = { colors: new Proxy({}, { get: () => '#000' }) } as any;

/** All text on screen, one string per Text element. */
export function texts(tree: any): string[] {
  return tree.root.findAll((node: any) => node.type === 'Text').map((node: any) => flat(node.props.children));
}
function flat(children: unknown): string {
  if (Array.isArray(children)) return children.map(flat).join('');
  return typeof children === 'string' || typeof children === 'number' ? String(children) : '';
}

/** Host elements with this accessibility label. */
export const labelled = (tree: any, label: string): any[] => tree.root.findAll((node: any) => typeof node.type === 'string' && node.props.accessibilityLabel === label);

/** The first host element with this label, as a user could press it: throws if it is missing or disabled. */
export function pressable(tree: any, label: string): any {
  const node = labelled(tree, label)[0];
  if (!node) throw new Error(`Nothing labelled "${label}" on screen`);
  if (node.props.disabled || node.props.accessibilityState?.disabled) throw new Error(`"${label}" is disabled`);
  return node;
}
