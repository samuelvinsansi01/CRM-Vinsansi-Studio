# Roteiro antes de consolidar o banco

## 1. Congelar regras operacionais
Antes de normalizar tabelas, validar em produção controlada:
- WhatsApp: Início -> Pré-Envio -> validação -> fila.
- Instagram direto: Início aprovado -> fila, apenas com capacidade.
- Retorno WhatsApp inválido: Pré-Envio WhatsApp -> Pré-Envio Instagram aguardando link -> fila após confirmação.
- Prioridade: retorno Instagram pronto antes de aprovação direta do Início.

## 2. Validar capacidade e rollover
- Limites por chip/dia para WhatsApp.
- Limites por perfil/dia para Instagram.
- Reposição após falha definitiva.
- Pendência após 22h e preenchimento do dia seguinte.
- Confirmar se a operação usará rollover por acesso ao painel ou cron agendado.

## 3. Fechar integrações reais
- Worker Evolution confirma validação por número exato.
- Worker WhatsApp registra `sent` ou `error` sem marcação antecipada.
- Extensão/worker Instagram confirma resultado antes de finalizar fila.
- Eventos de auditoria não podem interromper a transição principal.

## 4. Testar ciclo completo com poucos leads autorizados
- Importação, aprovação, pré-envio, fila, erro, pausa, reprocessamento, envio e Base Permanente.
- Conferir `leads`, `pre_send_leads`, filas, `base_permanente`, `sent_contacts` e `lead_events` após cada cenário.

## 5. Mapear legado sem apagar nada
- Levantar campos duplicados entre colunas e JSONB.
- Listar tabelas antigas ainda lidas pelo runtime.
- Identificar eventos com formato histórico diferente.
- Corrigir vínculos `user_id` já existentes antes de aplicar RLS definitivo.

## 6. Só então consolidar o banco
A migração final deve criar uma fonte de verdade por entidade, migrar e verificar dados, trocar o código para o contrato final e manter backup/rollback. Nenhuma tabela legada deve ser removida antes de reconciliação e relatório de divergências.
