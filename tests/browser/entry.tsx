import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FilesPanel } from '../../client/files';

const colors = {
  foreground: '#20232a', foregroundMuted: '#69717d', accent: '#6251d5', accentForeground: '#ffffff',
  surface0: '#ffffff', surface1: '#f3f4f7', surface2: '#e9eaf0', border: '#d9dce3',
  statusSuccess: '#26824c', statusDanger: '#b42318',
};
const theme = { id: 'browser-validation', name: 'Browser validation', colors } as any;
const params = new URLSearchParams(window.location.search);
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function Harness() {
  const [saved, setSaved] = useState<unknown>();
  const [modified, setModified] = useState(false);
  // The host can recreate its tab facade after persisting state. Keep this identity
  // churn in the fixture to catch effects that treat the facade as stable.
  const tab = { state: saved, setState: setSaved, setModified } as any;
  const props = {
    host: { id: 'synthetic-host' }, workspaceId: 'synthetic-workspace', tab,
    theme, layout: { compact: params.has('compact') ? params.get('compact') === '1' : window.innerWidth < 600, platform: params.get('platform') ?? 'android' },
  } as any;
  return <><div data-testid="tab-modified">{String(modified)}</div><FilesPanel {...props} /></>;
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={queryClient}><Harness /></QueryClientProvider>);
