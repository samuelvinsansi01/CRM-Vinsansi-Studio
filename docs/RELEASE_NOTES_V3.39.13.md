# V3.39.13 — Exceção configurável de nota para Instagram

- Mantém integralmente a qualificação principal por ramo/subramo, nota e reviews.
- Adiciona em Configurações > Importação a exceção de nota exclusiva para Instagram.
- Padrão: nota mínima 3,7; limite superior não inclusivo 4,0; mínimo de 5 avaliações.
- A exceção só vale para leads que correspondem a ramo/subramo ativo.
- Leads da exceção são aprovados com destino exclusivo Instagram e nunca seguem para WhatsApp.
- Sem Instagram válido, permanecem no Início e só entram na fila após o link ser informado.
- A configuração é persistida no JSON de configurações de importação já existente; não exige migration.
