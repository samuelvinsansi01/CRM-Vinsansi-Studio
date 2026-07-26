# Correção definitiva do funil por status

Cada tela agora recebe somente o status correspondente:

- Início: `lead_status_id = 1` (`importado`)
- Validados/Importar aprovados: `lead_status_id = 2` (`validado`)
- Pré-envio: `lead_status_id = 3` (`pre_envio`)
- Fila: `lead_status_id = 4` (`na_fila`)
- Base Permanente: `lead_status_id IN (5, 6, 7, 8)`

A Base Permanente possui filtro duplo: no Supabase e novamente no cliente. Assim, status ativos não aparecem nela mesmo que uma view ou política do banco retorne linhas extras.
