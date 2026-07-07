# V3.9 — Fluxo Instagram com prioridade de Pré-Envio

## Não exige SQL
Esta versão usa os campos JSON já persistidos em `pre_send_leads` e não cria nem remove tabelas. Não execute migrações para publicar esta versão.

## Regras implantadas

### WhatsApp inválido na validação inicial
- O lead deixa o card WhatsApp e permanece em `pre_send_leads`.
- O canal muda para `Instagram`.
- O status fica `review`.
- O registro recebe `instagramPendingLink=true`, motivo `whatsapp_invalid` e a observação `Aguardando link do Instagram`.
- O lead não volta ao Início, não entra em fila Instagram e não ocupa mais capacidade WhatsApp.

### Card Instagram do Pré-Envio
- Mostra os retornos de WhatsApp inválido que aguardam tratamento.
- Ações disponíveis por linha: visualizar/editar no drawer, invalidar e arquivar.
- Um link ou usuário Instagram só é aceito quando representa um perfil; domínio solto como `instagram.com` é rejeitado.
- Ao salvar um perfil válido, o sistema tenta encaminhar automaticamente o lead à fila Instagram.

### Prioridade e capacidade Instagram
1. Leads retornados do Pré-Envio WhatsApp com Instagram confirmado.
2. Leads aprovados diretamente no Início para Instagram.

A capacidade é calculada por **perfil Instagram + data**. Itens enviados, em fila, pausados, em follow-up ou com DM aberta ocupam vaga. Itens em erro liberam vaga para reposição.

Quando não houver vaga:
- retorno do WhatsApp permanece no Pré-Envio, como `approved`, com motivo `Aguardando capacidade do perfil Instagram`;
- lead vindo do Início permanece aprovado no Início;
- o botão `Preencher fila` fica desativado no cartão que já atingiu sua capacidade.

### Instagram aprovado no Início
- Um lead aprovado para Instagram com perfil válido tenta entrar diretamente na fila, sem criação de registro no Pré-Envio.
- Antes de enfileirar, o sistema drena primeiro os retornos prontos do Pré-Envio.
- Quando não existir capacidade, o lead aprovado permanece no Início.

### Corte de 22h
O projeto mantém o rollover já usado no Pré-Envio: após 22h, a próxima operação do painel move os pendentes para o próximo dia e aplica a mesma prioridade. Para execução automática exatamente às 22h, será necessário configurar uma rotina agendada no ambiente de deploy.

## Teste de aceite
1. Validar um WhatsApp inexistente: ele deve ir ao card Instagram, não ao Início.
2. Abrir o drawer, informar perfil válido e salvar: deve entrar em fila se houver vaga.
3. Com limite Instagram de 1, criar dois retornos prontos: somente um entra; o outro permanece no Pré-Envio aguardando capacidade.
4. Aprovar um lead Instagram no Início enquanto houver retorno pronto: o retorno entra primeiro.
5. Após uma falha definitiva na fila, atualizar ou preencher: a vaga deve ser usada primeiro pelo próximo retorno pronto.
6. Com capacidade cheia, confirmar que `Preencher fila` fica indisponível.
