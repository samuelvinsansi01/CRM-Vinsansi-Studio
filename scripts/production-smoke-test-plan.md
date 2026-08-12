# Plano de smoke test — PRODUÇÃO

Executar somente após A–D do checklist de deploy estarem em GO. Usar exclusivamente usuário, ramo, remetentes e destinatários controlados. Registrar evidências sem copiar tokens, chaves, telefones ou conteúdo sensível. Parar no primeiro efeito inesperado; não compensar falhas alterando banco diretamente.

1. **Login** — autenticar no domínio principal e confirmar que o CRM lê o próprio perfil em `public.users`. STOP se houver loop, perfil ausente ou acesso cruzado.
2. **Abrir Importação** — abrir a página ativa sem erro de schema, catálogo ou RLS.
3. **Confirmar fontes** — verificar que aparecem somente `Manual` e `Google Maps Extension`; nenhum botão, aba, CTA, conta ou job Apify.
4. **Criar lead manual WhatsApp** — selecionar ramo ativo, informar nome e telefone controlado, sem site, e criar somente um lead.
5. **Confirmar branch/source/channel** — conferir `branches_id` escolhido, canal WhatsApp e origem `sem_site`; `WhatsApp` não pode aparecer como contact source.
6. **Validar WhatsApp via Evolution** — aguardar a resposta da Evolution; o lead não pode nascer ou aparecer válido antes da resposta persistida.
7. **Confirmar proof persistido** — confirmar tentativa concluída, provider Evolution, snapshot do telefone atual e resultado correspondente. STOP se a UI anunciar sucesso antes da RPC.
8. **Criar lead Instagram** — usar outro destinatário controlado em formato aceito (`username`, `@username` ou URL de perfil) e confirmar origem/canal `instagram`.
9. **Confirmar normalização sem chamada externa** — conferir username canônico e ausência de requisição de “validação” ao Instagram durante o cadastro.
10. **Testar Google Maps via JSON controlado** — colar payload mínimo exportado/compatível contendo nome, categoria/ramo, localização, Maps URL e contato controlado; revisar a prévia antes de aprovar.
11. **Confirmar simulationMode** — com simulação ativa, executar a análise e confirmar relatório com zero leads persistidos.
12. **Persistir lote pequeno controlado** — após decisão explícita de desativar a simulação, repetir com o menor conjunto possível e confirmar somente os leads previstos.
13. **Confirmar fila** — preparar uma fila pequena; para WhatsApp, exigir prova atual dentro da transação. Instagram não deve exigir prova Evolution. Não iniciar lote fora da janela.
14. **Confirmar Monitoramento** — abrir a página, verificar `workers`, `queues`, `reconciliation`, `batches`, `alerts` e `latestRecovery` sem referência a `worker_batches_status`.
15. **Confirmar Worker heartbeat** — verificar heartbeat recente, versão esperada e métricas sem recovery/scheduler preso.
16. **Confirmar dispatch direto 410** — com autenticação/token apropriado, verificar HTTP 410 em `/api/whatsapp/dispatch` e `/dispatch/whatsapp`; nenhuma rota deve executar `dispatchOne` diretamente.
17. **Testar extensão Instagram** — vincular perfil autorizado, carregar um destinatário controlado, confirmar claim único e executar o menor teste autorizado. Resultado incerto deve terminar em reconciliação, nunca em retry/fallback automático.

## Encerramento

GO somente quando os 17 passos tiverem evidência coerente e não houver alertas críticos. Em STOP, pause o fluxo persistente aplicável, preserve estados incertos, reverta apenas o componente de aplicação afetado e mantenha o banco/migrations intactos.
