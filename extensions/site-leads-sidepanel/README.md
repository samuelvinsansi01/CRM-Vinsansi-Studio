# Lead Certo — Validação de Sites

## Configuração

1. Na plataforma/Vercel, configure `SITE_LEADS_EXTENSION_SECRET` com um valor forte.
2. Edite `config.js` e informe:
   - `apiBaseUrl`: domínio público da plataforma, sem barra final.
   - `secret`: o mesmo valor de `SITE_LEADS_EXTENSION_SECRET`.
3. Publique a plataforma com a rota `/api/site-leads`.
4. No Chrome, abra `chrome://extensions`, ative o modo desenvolvedor e use **Carregar sem compactação** apontando para esta pasta.
5. Clique no ícone da extensão para abrir o painel lateral.

## Regras

- Aprovar altera somente leads com destino **Com site** para `approved`.
- Invalidar altera somente leads com destino **Com site** para `invalid`.
- Cada aba mantém seu texto separadamente em `chrome.storage.local`.
- Após sucesso, somente o campo da aba executada é limpo.
- A correspondência prioriza URL exata normalizada; domínio é usado apenas quando há um único lead compatível.
