window.V51_DATABASE_REAL_SQL = `
-- Schema legado desativado.
--
-- A fila operacional nao usa mais a tabela legada de snapshots.
-- Execute sql/00627_queue_items_fk_restructure.sql para manter:
--
-- leads
--   -> backlog_items (lead_id uuid FK leads.id on delete cascade)
--   -> queue_items   (lead_id uuid FK leads.id on delete cascade)
--
-- Nenhum item de fila deve guardar copia jsonb do lead.
`;
