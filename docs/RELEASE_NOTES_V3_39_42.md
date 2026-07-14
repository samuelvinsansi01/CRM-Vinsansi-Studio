# V3.39.42

- Aprovação pela extensão fixa o destino como Com site e remove a rota Instagram.
- Invalidação pela extensão grava/upsert o lead na Base Permanente antes de marcar o lead operacional como inválido.
- Operação idempotente por `site-invalid-<lead_id>`.
- Compatibilidade defensiva com schemas antigos: campos físicos opcionais são removidos do payload quando não existem.
- Nenhuma alteração no módulo de Templates ou na estrutura fixa de quatro mensagens.
