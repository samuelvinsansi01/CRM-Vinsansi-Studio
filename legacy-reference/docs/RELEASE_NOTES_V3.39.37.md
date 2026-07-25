# V3.39.37

- Restaura o contrato completo de quatro mensagens dos templates.
- Lê `part_1` a `part_4` e também os valores equivalentes em `data`, preservando textos já salvos no Supabase.
- Salva as quatro mensagens sem sobrescrever o conteúdo existente com valores vazios durante a edição.
- Propaga Mensagem 1–4 para Pré-Envio e filas de WhatsApp/Instagram.
- Mantém integralmente a correção de duplicidade isolada da V3.39.36.
