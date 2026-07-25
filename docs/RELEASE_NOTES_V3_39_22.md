# Lead Certo CRM V3.39.22

- Corrige a gravação do histórico de importação para leads duplicados.
- `lead_imports.lead_id` agora só recebe o ID quando o lead foi efetivamente persistido em `leads`.
- Duplicados continuam registrados em `lead_imports` com `lead_id = null`, preservando status, motivo e payload de auditoria.
- Nenhuma regra de ramo, nota, reviews, Base Permanente ou rota Instagram foi alterada.
