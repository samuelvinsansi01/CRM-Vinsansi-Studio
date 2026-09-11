BEGIN;

ALTER TABLE public.whatsapp_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_contacts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_contact_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_contact_aliases FORCE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_member_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_member_states FORCE ROW LEVEL SECURITY;

-- R60 is authoritative on Inbox RLS. Remove legacy permissive policies first so PostgreSQL OR-composition cannot weaken the new contract.
DO $$ DECLARE p record;
BEGIN
  FOR p IN SELECT pol.polname,tab.relname AS tablename
           FROM pg_policy pol JOIN pg_class tab ON tab.oid=pol.polrelid JOIN pg_namespace n ON n.oid=tab.relnamespace
           WHERE n.nspname='public' AND tab.relname IN ('whatsapp_contacts','whatsapp_contact_aliases','conversations','conversation_messages','conversation_member_states')
  LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',p.polname,p.tablename); END LOOP;
END $$;

CREATE POLICY whatsapp_contacts_r60_select ON public.whatsapp_contacts FOR SELECT TO authenticated
USING (organizations_id = (SELECT public.current_organization_id()) AND (SELECT public.has_organization_permission('whatsapp.view')));

CREATE POLICY whatsapp_contact_aliases_r60_select ON public.whatsapp_contact_aliases FOR SELECT TO authenticated
USING (organizations_id = (SELECT public.current_organization_id()) AND (SELECT public.has_organization_permission('whatsapp.view')));

CREATE POLICY conversations_r60_select ON public.conversations FOR SELECT TO authenticated
USING (organizations_id = (SELECT public.current_organization_id()) AND (SELECT public.has_organization_permission('whatsapp.view')));

CREATE POLICY conversation_messages_r60_select ON public.conversation_messages FOR SELECT TO authenticated
USING (organizations_id = (SELECT public.current_organization_id()) AND (SELECT public.has_organization_permission('whatsapp.view')));

CREATE POLICY conversation_member_states_r60_select ON public.conversation_member_states FOR SELECT TO authenticated
USING (organizations_id = (SELECT public.current_organization_id()) AND organization_members_id=(SELECT public.current_organization_member_id()));

COMMIT;
