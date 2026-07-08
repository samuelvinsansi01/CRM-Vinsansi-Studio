# V3.34 — Instagram: persistência idempotente por contato

- Corrige a interrupção da extensão quando `base_permanente` já possui o mesmo `user_id + normalized_phone`.
- Antes de criar Base Permanente e `sent_contacts`, a API procura o contato existente por telefone normalizado e, como fallback, por usuário do Instagram.
- Quando a identidade já existe, atualiza o registro existente e preserva o histórico; não tenta criar um segundo registro com outro UUID.
- A auditoria `lead_events` passa a ser idempotente pelo UUID do item da fila.
- O item da fila somente é marcado como enviado depois que Base, contatos e auditoria forem persistidos.
