BEGIN;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Browser-facing RPCs: actor is always derived from auth.uid().
REVOKE ALL ON FUNCTION public.r60_require_actor(bigint,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.r60_require_actor(bigint,text) TO authenticated;
REVOKE ALL ON FUNCTION public.service_stage5_list_conversations(bigint,bigint,text,boolean,boolean,text,timestamptz,bigint,integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.service_stage5_list_conversations(bigint,bigint,text,boolean,boolean,text,timestamptz,bigint,integer,text) TO authenticated;
REVOKE ALL ON FUNCTION public.service_stage5_list_messages(bigint,bigint,bigint,bigint,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.service_stage5_list_messages(bigint,bigint,bigint,bigint,integer) TO authenticated;
REVOKE ALL ON FUNCTION public.service_stage5_mark_read(bigint,bigint,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.service_stage5_mark_read(bigint,bigint,bigint) TO authenticated;
REVOKE ALL ON FUNCTION public.service_stage5_set_archived(bigint,bigint,boolean,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.service_stage5_set_archived(bigint,bigint,boolean,integer) TO authenticated;
REVOKE ALL ON FUNCTION public.service_stage5_assign_conversation(bigint,bigint,text,bigint,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.service_stage5_assign_conversation(bigint,bigint,text,bigint,integer) TO authenticated;
REVOKE ALL ON FUNCTION public.service_stage5_ignore_contact(bigint,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.service_stage5_ignore_contact(bigint,bigint) TO authenticated;
REVOKE ALL ON FUNCTION public.service_stage5_restore_contact(bigint,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.service_stage5_restore_contact(bigint,bigint) TO authenticated;
REVOKE ALL ON FUNCTION public.service_stage5_promote_unknown_contact(bigint,bigint,text,text,bigint,bigint,bigint,bigint,bigint,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.service_stage5_promote_unknown_contact(bigint,bigint,text,text,bigint,bigint,bigint,bigint,bigint,bigint) TO authenticated;
REVOKE ALL ON FUNCTION public.service_stage5_presence(bigint,bigint,text,boolean,boolean,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.service_stage5_presence(bigint,bigint,text,boolean,boolean,boolean) TO authenticated;

-- Machine-only ingress/worker contracts. Never executable by browser roles.
DO $$
DECLARE r record;
BEGIN
 FOR r IN
   SELECT p.oid::regprocedure AS sig
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND (
     p.proname LIKE 'worker\_%' ESCAPE '\' OR
     p.proname IN ('r60_assert_service_role','r60_assert_worker_gate','r60_resolve_whatsapp_contact','service_ingest_evolution_message','service_update_evolution_message_status','service_update_evolution_connection_state_r60','service_upsert_evolution_chat','service_stage5_converge_automatic_message')
   )
 LOOP
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',r.sig);
   EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',r.sig);
 END LOOP;
END $$;

REVOKE ALL ON public.whatsapp_contacts,public.whatsapp_contact_aliases,public.organization_messaging_state,public.platform_release_candidates,public.platform_release_promotions FROM PUBLIC,anon,authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.whatsapp_contacts,public.whatsapp_contact_aliases,public.conversations,public.conversation_messages FROM authenticated;

COMMIT;
