\set ON_ERROR_STOP on

INSERT INTO public.organizations VALUES(10,1001,1);
INSERT INTO public.organization_tools(organizations_id,tool_id,enabled) VALUES
  (10,'vinsansi_capture',true),(10,'vinsansi_instagram',true),(10,'vinsansi_whatsapp_manager',true);
INSERT INTO public.platform_tools(tool_id) VALUES
  ('vinsansi_capture'),('vinsansi_instagram'),('vinsansi_whatsapp_manager');

INSERT INTO public.organization_tool_installations(
  organization_tool_installations_id,organizations_id,tool_id,external_installation_id,
  registration_status,installed_version,last_seen_at,registered_at,metadata,created_at,updated_at
) VALUES
  ('10000000-0000-0000-0000-000000000001',10,'vinsansi_capture','capture-old','registered','1.0.8',now()-interval '30 days',now()-interval '60 days','{"source":"google_maps"}',now()-interval '60 days',now()-interval '30 days'),
  ('10000000-0000-0000-0000-000000000002',10,'vinsansi_capture','capture-current','registered','1.0.10',now(),now()-interval '2 days','{"source":"google_maps"}',now()-interval '2 days',now()),
  ('10000000-0000-0000-0000-000000000011',10,'vinsansi_instagram','instagram-alpha-old','registered','2.0.3',now()-interval '20 days',now()-interval '40 days','{"instagramProfile":"alpha"}',now()-interval '40 days',now()-interval '20 days'),
  ('10000000-0000-0000-0000-000000000012',10,'vinsansi_instagram','instagram-alpha-current','registered','2.0.5',now(),now()-interval '1 day','{"instagramProfile":"@Alpha"}',now()-interval '1 day',now()),
  ('10000000-0000-0000-0000-000000000013',10,'vinsansi_instagram','instagram-beta-current','registered','2.0.5',now(),now()-interval '1 day','{"instagramProfile":"beta"}',now()-interval '1 day',now()),
  ('10000000-0000-0000-0000-000000000021',10,'vinsansi_whatsapp_manager','manager-old','registered','1.3.0',now()-interval '10 days',now()-interval '20 days','{}',now()-interval '20 days',now()-interval '10 days'),
  ('10000000-0000-0000-0000-000000000022',10,'vinsansi_whatsapp_manager','manager-current','registered','1.3.2',now(),now()-interval '1 day','{}',now()-interval '1 day',now());

INSERT INTO public.tool_installation_credentials(
  organization_tool_installations_id,credential_hash,issued_to_external_installation_id
) VALUES
  ('10000000-0000-0000-0000-000000000001',repeat('1',64),'capture-old'),
  ('10000000-0000-0000-0000-000000000002',repeat('2',64),'capture-current'),
  ('10000000-0000-0000-0000-000000000011',repeat('3',64),'instagram-alpha-old');
INSERT INTO public.tool_user_sessions(
  organization_tool_installations_id,users_id,organizations_id,organization_members_id,session_hash
) VALUES
  ('10000000-0000-0000-0000-000000000001',1001,10,10001,repeat('4',64)),
  ('10000000-0000-0000-0000-000000000002',1001,10,10001,repeat('5',64));

INSERT INTO public.platform_runtime_heartbeats(
  organizations_id,organization_tool_installations_id,component_type,component_key,component_version,runtime_status,last_seen_at
) VALUES
  (10,'10000000-0000-0000-0000-000000000001','capture','capture-old','1.0.8','online',now()-interval '30 days'),
  (10,'10000000-0000-0000-0000-000000000002','capture','capture-current','1.0.10','online',now()),
  (10,'10000000-0000-0000-0000-000000000011','instagram','instagram-alpha-old','2.0.3','online',now()-interval '20 days'),
  (10,'10000000-0000-0000-0000-000000000012','instagram','instagram-alpha-current','2.0.5','online',now()),
  (10,'10000000-0000-0000-0000-000000000013','instagram','instagram-beta-current','2.0.5','online',now()),
  (10,'10000000-0000-0000-0000-000000000021','manager','manager-old','1.3.0','online',now()-interval '10 days'),
  (10,'10000000-0000-0000-0000-000000000022','manager','manager-current','1.3.2','online',now()),
  (10,NULL,'worker','worker-current','3.13.0','online',now());

