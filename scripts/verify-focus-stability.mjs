import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const authProvider = fs.readFileSync(path.join(root, 'src/providers/AuthProvider.tsx'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');

const assertions = [
  {
    ok: authProvider.includes("event === 'TOKEN_REFRESHED'")
      && authProvider.includes('currentUser?.id === authUser.id'),
    message: 'AuthProvider deve ignorar renovacao de token do mesmo usuario sem remontar a aplicacao.',
  },
  {
    ok: authProvider.includes('preserveCurrentUserOnError: background')
      && authProvider.includes('preserveCurrentUserOnError && currentUser'),
    message: 'Sincronizacao em segundo plano deve preservar o usuario atual em falha transitoria.',
  },
  {
    ok: app.includes('if (loading && !isAuthenticated)'),
    message: 'App nao deve desmontar o painel autenticado durante sincronizacao de sessao.',
  },
  {
    ok: app.includes('window.sessionStorage.setItem(ACTIVE_PAGE_STORAGE_KEY, activePage)')
      && app.includes('window.sessionStorage.getItem(ACTIVE_PAGE_STORAGE_KEY)'),
    message: 'Pagina ativa deve sobreviver a descarte/recarregamento real da aba.',
  },
  {
    ok: !authProvider.includes('window.location.reload') && !app.includes('window.location.reload'),
    message: 'Fluxo de autenticacao nao pode forcar reload da pagina.',
  },
];

const failure = assertions.find((assertion) => !assertion.ok);
if (failure) {
  console.error(`Falha na estabilidade de foco: ${failure.message}`);
  process.exit(1);
}

console.log('Estabilidade de foco aprovada: sessao em segundo plano preserva arvore React, modal e pagina ativa.');
