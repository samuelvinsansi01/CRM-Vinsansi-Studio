# V3.39 — Importação exata e limite Instagram por perfil

## Alterações

- Restaurado o campo `Limite diário` no cadastro de cada perfil Instagram.
- A fila e o Pré-Envio passam a usar `instagram_profiles.daily_limit` do perfil selecionado, mantendo o limite global como fallback de compatibilidade.
- A importação passa a exigir correspondência exata normalizada do `categoryName` da Apify com as categorias/subramos cadastrados no banco.
- O card “Regras por ramo” continua sendo composto pelos registros reais da tabela de ramos, incluindo categorias associadas.
- Mantida rota secundária para Instagram quando o ramo foi reconhecido, os mínimos foram atendidos e existe Instagram válido, mas a classificação principal recusaria o destino.
- Preservados deduplicação, motivos de recusa, WhatsApp, Pré-Envio, filas e estrutura limpa da prévia.

## Compatibilidade

Perfis antigos sem `daily_limit` continuam operando com o limite global padrão até serem salvos novamente.
