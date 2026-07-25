# V3.39.19

## Correção da deduplicação por telefone normalizado

- A Base Permanente agora fornece ao importador somente telefones normalizados, priorizando `normalizedPhone` e usando `phone` como fallback.
- Os telefones oriundos de `sent_contacts` e dos leads enviados também são normalizados antes da comparação.
- O validador de importação normaliza defensivamente todos os valores recebidos em `basePhones` e `sentPhones` antes de construir os conjuntos de deduplicação.
- A alteração não modifica as regras de ramo, qualificação, nota, avaliações, destino ou exceção do Instagram.

Com isso, formatos como `(11) 99999-8888`, `11999998888` e `+55 11 99999-8888` são comparados pela mesma chave `5511999998888`.
