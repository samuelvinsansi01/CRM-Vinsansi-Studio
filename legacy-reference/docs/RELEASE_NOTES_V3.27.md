# Lead Certo V3.27

- Adiciona preflight fail-closed antes da validação e revalidação WhatsApp.
- Com Docker, chip ou Evolution indisponíveis, a operação é interrompida com HTTP 503.
- Indisponibilidade não pode alterar status de leads nem disparar retorno para Instagram.
- O frontend diferencia indisponibilidade de infraestrutura de resultado real do provider.
- Requer Worker V2.1 e as variáveis de ambiente descritas em `V3_27_VALIDACAO_FAIL_CLOSED.md`.
