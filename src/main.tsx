import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { AppProviders } from './providers';
import { applyThemeVariables } from './design-system/theme/applyTheme';
import { loadRuntimeConfig } from './lib/runtimeConfig';
import './styles/base.css';
import './styles/components.css';
import './styles/pages.css';

applyThemeVariables();

async function start() {
  await loadRuntimeConfig();
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <AppProviders>
        <App />
      </AppProviders>
    </React.StrictMode>,
  );
}

void start().catch((error) => {
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML = `<main style="font-family:Inter,Segoe UI,Arial,sans-serif;background:#0b0b0b;color:#fff;min-height:100vh;display:grid;place-items:center;padding:32px;box-sizing:border-box"><div style="max-width:640px"><h1 style="font-size:24px">CRM temporariamente indisponível</h1><p style="color:#aaa;line-height:1.6">Não foi possível carregar a configuração central da plataforma. Tente novamente em alguns instantes.</p><code style="color:#777">${String(error instanceof Error ? error.message : error).replace(/[<>&]/g, '')}</code></div></main>`;
  }
});
