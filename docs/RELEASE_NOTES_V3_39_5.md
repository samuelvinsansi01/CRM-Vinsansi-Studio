# V3.39.5

- Corrige a incompatibilidade `uuid = text` na RPC de limite diário do Instagram.
- A função passa a comparar `id` e `user_id` por representação textual, compatível com bancos onde essas colunas são UUID ou TEXT.
- Remove assinaturas antigas da RPC para evitar ambiguidade no PostgREST.
- Mantém a confirmação do valor efetivamente persistido no banco.
