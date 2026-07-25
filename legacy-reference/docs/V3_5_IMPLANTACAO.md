# Lead Certo V3.5 — validação estrita e auditoria segura

## O que foi corrigido

1. A validação em lote não associa mais o resultado pela posição da lista.
   Cada retorno da Evolution precisa conter o próprio número (telefone ou JID) para ser aplicado ao lead.
2. `status: ok`, `status: valid` ou `status: exists` isolados não aprovam mais um lead.
   A aprovação exige `exists/valid/... = true` ou JID terminando em `@s.whatsapp.net`, sempre vinculado ao número consultado.
3. Sem resposta explícita, sem número correspondente ou com erro do provider, o lead vai para `review`.
4. `Validar leads` e `Revalidar aprovados` continuam usando a mesma consulta real à Evolution, mas enviam modos distintos (`initial` e `revalidation`) e possuem transições de estado separadas.
5. A auditoria passa a usar a RPC `append_lead_event`, que verifica o usuário autenticado e grava com segurança mesmo com RLS ativo. Falha de auditoria não interrompe a decisão de validação.

## Ordem de publicação

1. No Supabase SQL Editor, execute `supabase/migration_v3_5_strict_validation_and_audit.sql`.
2. Publique este código na Vercel.
3. Confirme na Vercel: `DRY_RUN=false`, `EVOLUTION_API_URL` e `EVOLUTION_API_KEY` definidos.
4. Faça um teste com um lead apenas. Em Logs, a chamada deve trazer `mode: initial` ou `mode: revalidation` e `provider: evolution`.
5. Use `Revalidar aprovados` para reexaminar os registros que foram aprovados antes desta correção. Resultados ambíguos vão para revisão.

## Observação

Não use a revalidação para envio. Ela não cria itens de fila e não dispara mensagens.
