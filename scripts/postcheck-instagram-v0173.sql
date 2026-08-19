SELECT jsonb_build_object(
  'instagramClaimPendingOnly', EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='instagram_claim_queue_item'
      AND pg_get_functiondef(p.oid) LIKE '%v_item.status_id<>3%'
      AND pg_get_functiondef(p.oid) LIKE '%''sent'',''invalid'',''error'',''reconciliation_required''%'
  ),
  'instagramUpdatePersistsSents', EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='instagram_update_queue_progress'
      AND pg_get_functiondef(p.oid) LIKE '%instagram-queue-item:%'
      AND pg_get_functiondef(p.oid) LIKE '%INSERT INTO public.sents%'
      AND pg_get_functiondef(p.oid) LIKE '%instagram_error_after_dispatch_requires_reconciliation%'
  ),
  'instagramReprocessRpc', to_regprocedure('public.instagram_reprocess_queue_items(bigint[])') IS NOT NULL,
  'instagramInvalidateRpc', to_regprocedure('public.instagram_invalidate_queue_item(bigint,text)') IS NOT NULL,
  'sentsIdempotencyIndex', to_regclass('public.sents_idempotency_key_unique') IS NOT NULL,
  'instagramProgressTable', to_regclass('public.instagram_queue_progress') IS NOT NULL,
  'readyForInstagramV0173',
    to_regprocedure('public.instagram_reprocess_queue_items(bigint[])') IS NOT NULL
    AND to_regprocedure('public.instagram_invalidate_queue_item(bigint,text)') IS NOT NULL
    AND to_regclass('public.sents_idempotency_key_unique') IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='instagram_claim_queue_item'
        AND pg_get_functiondef(p.oid) LIKE '%v_item.status_id<>3%'
    )
    AND EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='instagram_update_queue_progress'
        AND pg_get_functiondef(p.oid) LIKE '%INSERT INTO public.sents%'
        AND pg_get_functiondef(p.oid) LIKE '%instagram_error_after_dispatch_requires_reconciliation%'
    )
) AS instagram_v0173_postcheck;
