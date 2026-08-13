# Ordem das migrations

1. `20260730171000_user_profile.sql`
2. `20260802070000_atomic_queue_preparation.sql`
3. `20260802080000_queue_payload_snapshot.sql`
4. `20260802090000_worker_persistence_idempotency.sql`
5. `20260802100000_secure_credentials_integrations.sql`
6. `20260802110000_centralized_operational_settings.sql`
7. `20260802120000_persistent_audit_state_machine.sql`
8. `20260802130000_identity_dedup_suppression.sql`
9. `20260802140000_permanent_base_consolidation.sql`
10. `20260802150000_instagram_execution_progress.sql`
11. `20260802160000_schema_release_manifest.sql`
12. `20260802170000_observability_recovery.sql`
13. `20260802180000_chip_conversations_chat.sql`

Nunca pule uma migration em um ambiente novo. Em ambiente existente, execute apenas as ainda não aplicadas.
