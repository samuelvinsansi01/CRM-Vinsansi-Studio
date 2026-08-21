# CRM - Vinsansi Studio v1.0.2 — saneamento Evolution Go

## Objetivo

Esta versão alinha o CRM à arquitetura consolidada no Gerenciador de Disparos v1.0.2. O CRM continua sendo a fonte canônica de leads, validação, roteamento, capacidade e filas; o Gerenciador continua sendo o executor WhatsApp com Evolution Go, Gateway 1.2.0 e Worker 3.8.0 embarcado.

## Estado administrativo x estado operacional

`instances.status_id` não representa mais o WebSocket instantâneo. Ele é o estado administrativo do cadastro.

A nova tabela `instance_runtime_states` guarda a telemetria Evolution Go:

- `operational_state`: `online`, `reconnecting`, `session_saved`, `disconnected`, `unavailable` ou `unknown`;
- `session_saved`;
- `socket_connected`;
- `jid`;
- último erro e instante da checagem.

Uma queda temporária do socket não desativa a instância no CRM.

## Elegibilidade de chips para WhatsApp

Uma instância administrativamente ativa só pode receber novos itens de fila WhatsApp quando existe uma sessão persistida conhecida (`session_saved=true`).

Consequências:

- `online`: pode operar;
- `reconnecting`: continua elegível, pois a sessão existe;
- `session_saved`: continua elegível, pois a sessão existe;
- `disconnected` sem sessão: não recebe novos itens;
- falha temporária de leitura (`unavailable`) não apaga a última prova de sessão salva.

O banco reforça essa regra dentro da RPC canônica de preparação da fila. O frontend não é a única barreira.

## Worker

O Worker standalone deixou de ser um produto distribuído pelo CRM.

- `public/tools/worker-latest.zip` foi removido;
- o manifesto de Ferramentas não publica mais Worker;
- Worker oficial desta linha: 3.8.0, embarcado no Gerenciador;
- `/api/desktop/worker-provision` permanece porque é o contrato seguro usado pelo Gerenciador para provisionar o runtime.

## Conversas

Conversas ainda permanecem no CRM nesta versão por segurança de transição. A remoção definitiva só acontece depois que o Gerenciador possuir paridade funcional de inbox/mensagens. Não há duas bases novas de conversa nesta etapa.

## Aplicação no Supabase

Aplicar, na ordem, as migrations novas:

1. `20260820210000_instance_runtime_state.sql`
2. `20260820211000_whatsapp_queue_runtime_guard.sql`

O arquivo `APLICAR-NO-SUPABASE-v1.0.2.sql` contém as duas na ordem correta para aplicação manual.

Depois, publicar as Edge Functions atualizadas:

- `evolution-instance-sync`;
- `evolution-connection-webhook`.

Por fim, publicar o frontend/API do CRM.

## Validação executada

A suíte relevante desta alteração passou, incluindo:

- contrato Evolution Go;
- fila atômica + guard de sessão persistida;
- Worker/idempotência;
- credenciais/Vault;
- Ferramentas sem Worker standalone;
- pacote manual de migrations;
- pacote de deploy;
- observabilidade;
- validação sintática de 212 arquivos TypeScript.

A varredura ampliada passou em 48 verificadores. Falhas restantes da suíte completa são pré-existentes ou dependem de fontes auxiliares que não vieram junto no ZIP atual (por exemplo, fonte Google Maps 0.17.1 e arquivos de referência externos); não são regressões desta alteração.

## Próxima etapa

Completar no Gerenciador a operação WhatsApp que ainda está no CRM, especialmente Conversas/mensagens e a decisão final sobre os controles técnicos da fila. Somente após paridade funcional a tela Conversas será removida do CRM.
