CREATE OR REPLACE FUNCTION public.stage5_assert(p_condition boolean,p_name text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF coalesce(p_condition,false) IS NOT TRUE THEN RAISE EXCEPTION 'stage5_assert_failed:%',p_name;END IF;RAISE NOTICE 'ok:%',p_name;END$$;

DO $$BEGIN
  PERFORM public.service_stage5_list_conversations(10,104,NULL,'all',false,false,NULL,NULL,NULL,50);
  PERFORM public.stage5_assert(true,'view_without_reply_can_list');
  BEGIN PERFORM public.service_stage5_assign_conversation(10,101,2,'assume',NULL,1);RAISE EXCEPTION 'expected';EXCEPTION WHEN OTHERS THEN PERFORM public.stage5_assert(position('conversation_not_found' in SQLERRM)>0,'cross_org_conversation_id_denied');END;
  BEGIN PERFORM public.service_stage5_assign_conversation(10,999,1,'assume',NULL,1);RAISE EXCEPTION 'expected';EXCEPTION WHEN OTHERS THEN PERFORM public.stage5_assert(position('permission_denied' in SQLERRM)>0,'platform_owner_without_membership_denied');END;
  BEGIN PERFORM public.service_stage5_assign_conversation(10,103,1,'assume',NULL,1);RAISE EXCEPTION 'expected';EXCEPTION WHEN OTHERS THEN PERFORM public.stage5_assert(position('permission_denied' in SQLERRM)>0,'inactive_membership_denied');END;
  BEGIN PERFORM public.service_stage5_assign_conversation(10,104,1,'assume',NULL,1);RAISE EXCEPTION 'expected';EXCEPTION WHEN OTHERS THEN PERFORM public.stage5_assert(position('permission_denied' in SQLERRM)>0,'view_without_reply_denied');END;
  BEGIN PERFORM public.service_stage5_presence(10,104,1,'session-viewonly',true,true,false);RAISE EXCEPTION 'expected';EXCEPTION WHEN OTHERS THEN PERFORM public.stage5_assert(position('permission_denied' in SQLERRM)>0,'view_without_reply_cannot_type');END;
END$$;

INSERT INTO public.conversation_messages(users_id,organizations_id,conversations_id,chips_id,instances_id,external_message_id,remote_jid,direction,from_me,message_type,message_body,message_status,executed_by)
VALUES(1,10,1,501,1001,'in-1','5511999999999@s.whatsapp.net','inbound',false,'text','Olá','delivered','system'),
      (1,10,1,501,1001,'in-2','5511999999999@s.whatsapp.net','inbound',false,'text','Tudo bem?','delivered','system');
SELECT public.service_stage5_mark_read(10,101,1,NULL);
SELECT public.stage5_assert((SELECT last_read_message_id IS NOT NULL FROM public.conversation_member_states WHERE organization_members_id=101),'read_state_member_one');
SELECT public.stage5_assert(NOT EXISTS(SELECT 1 FROM public.conversation_member_states WHERE organization_members_id=102),'read_state_independent_member_two');

DO $$DECLARE before_count bigint;BEGIN SELECT count(*) INTO before_count FROM public.audit_events;PERFORM public.service_stage5_presence(10,101,1,'session-abcdefgh',true,true,false);PERFORM public.stage5_assert((SELECT typing FROM public.conversation_presence WHERE organization_members_id=101),'typing_present');UPDATE public.conversation_presence SET typing_seen_at=now()-interval '9 seconds';PERFORM public.service_stage5_presence(10,102,1,'session-ijklmnop',true,false,false);PERFORM public.stage5_assert((SELECT typing=false FROM public.conversation_presence WHERE organization_members_id=101),'typing_ttl');UPDATE public.conversation_presence SET expires_at=now()-interval '1 second';PERFORM public.service_stage5_presence(10,102,1,'session-ijklmnop',true,false,false);PERFORM public.stage5_assert(NOT EXISTS(SELECT 1 FROM public.conversation_presence WHERE organization_members_id=101),'viewer_ttl');PERFORM public.stage5_assert((SELECT count(*) FROM public.audit_events)=before_count,'presence_no_audit_flood');END$$;

DO $$DECLARE first jsonb;second jsonb;BEGIN
 first:=public.service_stage5_prepare_manual_message(10,101,1,2,'11111111-1111-4111-8111-111111111111','Resposta','text',NULL,NULL,NULL,NULL);
 second:=public.service_stage5_prepare_manual_message(10,101,1,2,'11111111-1111-4111-8111-111111111111','Resposta','text',NULL,NULL,NULL,NULL);
 PERFORM public.stage5_assert((first->>'messageId')=(second->>'messageId'),'manual_send_idempotent');
 PERFORM public.stage5_assert((SELECT sent_by_member_id=101 AND executed_by='member' FROM public.conversation_messages WHERE conversation_messages_id=(first->>'messageId')::bigint),'manual_authorship');
 PERFORM public.service_stage5_report_manual_message(10,101,(first->>'messageId')::bigint,'sending',NULL,NULL,'{}');
 PERFORM public.service_stage5_report_manual_message(10,101,(first->>'messageId')::bigint,'reconciliation_required',NULL,'timeout','{}');
 PERFORM public.stage5_assert((SELECT message_status='reconciliation_required' FROM public.conversation_messages WHERE conversation_messages_id=(first->>'messageId')::bigint),'uncertain_send_reconciliation');
END$$;

DO $$DECLARE prepared jsonb;BEGIN
 prepared:=public.service_stage5_prepare_manual_message(10,101,1,2,'33333333-3333-4333-8333-333333333333','Ordem invertida','text',NULL,NULL,NULL,NULL);
 PERFORM public.service_ingest_evolution_message(1001,'send_message','manual-before-report','5511999999999@s.whatsapp.net',true,'text','Ordem invertida','sent',NULL,now(),'{}',NULL,NULL,NULL,NULL);
 PERFORM public.service_stage5_report_manual_message(10,101,(prepared->>'messageId')::bigint,'sent','manual-before-report',NULL,'{}');
 PERFORM public.stage5_assert((SELECT count(*)=1 AND bool_and(executed_by='member' AND sent_by_member_id=101) FROM public.conversation_messages WHERE external_message_id='manual-before-report'),'manual_webhook_order_independent_merge');
END$$;

DO $$BEGIN
 BEGIN PERFORM public.service_stage5_assign_conversation(10,101,1,'transfer',201,2);RAISE EXCEPTION 'expected';EXCEPTION WHEN OTHERS THEN PERFORM public.stage5_assert(position('transfer_target_invalid' in SQLERRM)>0,'cross_org_transfer_denied');END;
 PERFORM public.service_stage5_assign_conversation(10,101,1,'transfer',102,2);
 BEGIN PERFORM public.service_stage5_prepare_manual_message(10,101,1,3,'22222222-2222-4222-8222-222222222222','bloqueada','text',NULL,NULL,NULL,NULL);RAISE EXCEPTION 'expected';EXCEPTION WHEN OTHERS THEN PERFORM public.stage5_assert(position('assigned_to_other_member' in SQLERRM)>0,'reply_assigned_to_other_blocked');END;
END$$;

SELECT public.service_stage5_converge_automatic_message(10,7001,'auto-1','5511888888888@s.whatsapp.net','Prospecção','text');
SELECT public.service_ingest_evolution_message(1001,'send_message','auto-1','5511888888888@s.whatsapp.net',true,'text','Prospecção','sent',NULL,now(),'{}',NULL,NULL,NULL,NULL);
SELECT public.stage5_assert((SELECT count(*)=1 AND bool_and(queue_items_id=7001 AND sent_by_member_id=101 AND executed_by='system') FROM public.conversation_messages WHERE external_message_id='auto-1'),'worker_webhook_merge_and_authorship');
SELECT public.service_update_evolution_message_status(1001,'auto-1','delivered','messages_update','{}',now());
SELECT public.service_update_evolution_message_status(1001,'auto-1','sent','messages_update','{}',now());
SELECT public.stage5_assert((SELECT message_status='delivered' FROM public.conversation_messages WHERE external_message_id='auto-1'),'provider_status_monotonic');
SELECT public.service_ingest_evolution_message(1001,'messages_upsert','reply-1','5511888888888@s.whatsapp.net',false,'text','Resposta inbound','delivered','Lead',now(),'{}',NULL,NULL,NULL,NULL);
SELECT public.stage5_assert((SELECT assigned_to_member_id=101 FROM public.conversations WHERE remote_jid='5511888888888@s.whatsapp.net'),'active_originator_initial_assignment');

UPDATE public.organization_members SET status_id=2 WHERE organization_members_id=101;
SELECT public.service_stage5_converge_automatic_message(10,7002,'auto-2','5511777777777@s.whatsapp.net','Prospecção','text');
SELECT public.service_ingest_evolution_message(1001,'messages_upsert','reply-2','5511777777777@s.whatsapp.net',false,'text','Resposta inbound','delivered','Lead',now(),'{}',NULL,NULL,NULL,NULL);
SELECT public.stage5_assert((SELECT assigned_to_member_id IS NULL FROM public.conversations WHERE remote_jid='5511777777777@s.whatsapp.net'),'inactive_originator_unassigned');

-- Payload real Evolution Go 0.7.2 normalizado pelo Gateway: primeiro inbound,
-- conversa existente, idempotência, dois chips e mídia. O RPC não depende do
-- Gerenciador estar aberto e organizations_id vem exclusivamente da instância.
DO $$DECLARE first jsonb;duplicate jsonb;existing jsonb;second_chip jsonb;media jsonb;listed jsonb;BEGIN
 first:=public.service_ingest_evolution_message(1001,'messages_upsert','A5BB8F142F9075F7BCDB39834CEB6DD2','5511999990001@s.whatsapp.net',false,'text','[conteúdo removido do fixture]','delivered','Prospect homologação','2026-08-22T13:19:14Z','{"source":"evolution-go-0.7.2"}',NULL,NULL,NULL,NULL);
 duplicate:=public.service_ingest_evolution_message(1001,'messages_upsert','A5BB8F142F9075F7BCDB39834CEB6DD2','5511999990001@s.whatsapp.net',false,'text','[conteúdo removido do fixture]','delivered','Prospect homologação','2026-08-22T13:19:14Z','{"duplicate":true}',NULL,NULL,NULL,NULL);
 PERFORM public.stage5_assert((first->>'merged')='false' AND (duplicate->>'merged')='true','real_go_first_insert_then_merge');
 PERFORM public.stage5_assert((SELECT count(*)=1 FROM public.conversation_messages WHERE organizations_id=10 AND instances_id=1001 AND external_message_id='A5BB8F142F9075F7BCDB39834CEB6DD2'),'real_go_external_id_idempotent');
 PERFORM public.stage5_assert((SELECT organizations_id=10 AND chips_id=501 AND direction='inbound' AND from_me=false AND executed_by='system' FROM public.conversation_messages WHERE external_message_id='A5BB8F142F9075F7BCDB39834CEB6DD2'),'real_go_tenant_chip_direction');
 existing:=public.service_ingest_evolution_message(1001,'messages_upsert','REAL-EXISTING-1','5511999999999@s.whatsapp.net',false,'text','Conversa existente','delivered','Lead inicial',now(),'{}',NULL,NULL,NULL,NULL);
 PERFORM public.stage5_assert((existing->>'conversationId')='1','real_go_existing_conversation');
 second_chip:=public.service_ingest_evolution_message(1002,'messages_upsert','REAL-CHIP-8352-1','5511888000002@s.whatsapp.net',false,'text','Segundo chip','delivered','Lead B',now(),'{}',NULL,NULL,NULL,NULL);
 PERFORM public.stage5_assert((SELECT organizations_id=10 AND chips_id=502 AND instances_id=1002 FROM public.conversation_messages WHERE external_message_id='REAL-CHIP-8352-1'),'real_go_second_chip');
 media:=public.service_ingest_evolution_message(1002,'messages_upsert','REAL-MEDIA-1','5511888000002@s.whatsapp.net',false,'image',NULL,'delivered','Lead B',now(),'{}','https://example.invalid/media.jpg','image/jpeg','media.jpg',NULL);
 PERFORM public.stage5_assert((SELECT message_type='image' AND media_url='https://example.invalid/media.jpg' AND message_body IS NULL FROM public.conversation_messages WHERE external_message_id='REAL-MEDIA-1'),'real_go_media_placeholder');
 listed:=public.service_stage5_list_messages(10,102,(first->>'conversationId')::bigint,NULL,NULL,50);
 PERFORM public.stage5_assert(listed::text LIKE '%A5BB8F142F9075F7BCDB39834CEB6DD2%','real_go_query_returns_message');
END$$;
UPDATE public.organization_members SET status_id=1 WHERE organization_members_id=101;

SELECT public.service_stage5_queue_control(10,101,8001,'pause');
SELECT public.stage5_assert((SELECT status_id=8 FROM public.worker_batches WHERE worker_batches_id=8001),'queue_pause');
SELECT public.service_stage5_queue_control(10,101,8001,'resume');
SELECT public.stage5_assert((SELECT status_id=4 FROM public.worker_batches WHERE worker_batches_id=8001),'queue_resume');
DO $$BEGIN BEGIN PERFORM public.service_stage5_reprocess_queue_item(10,101,7002);RAISE EXCEPTION 'expected';EXCEPTION WHEN OTHERS THEN PERFORM public.stage5_assert(position('requires_reconciliation' in SQLERRM)>0,'no_blind_resend');END;END$$;
SELECT public.service_stage5_reprocess_queue_item(10,101,7003);
SELECT public.stage5_assert((SELECT status_id=3 FROM public.queue_items WHERE queue_items_id=7003),'safe_reprocess');
SELECT public.service_stage5_reconcile_queue_item(10,101,7001);
SELECT public.stage5_assert((SELECT public=false AND file_size_limit=26214400 FROM storage.buckets WHERE id='conversation-media'),'private_media_bucket');
