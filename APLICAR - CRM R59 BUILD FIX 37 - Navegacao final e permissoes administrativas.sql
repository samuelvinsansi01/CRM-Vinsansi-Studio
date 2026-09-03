-- CRM R59 BUILD FIX 37
-- Navegação final (frontend) + endurecimento da matriz Owner / Manager / Member.
--
-- Objetivos desta migration:
-- 1) Garantir que o nível manager sempre possua o conjunto operacional/administrativo
--    necessário para gerir a operação, independentemente da função delegável atribuída.
-- 2) Preservar ações críticas (propriedade, edição/exclusão de funções e plataforma)
--    fora desse mínimo; essas operações continuam protegidas pelas RPCs específicas.
-- 3) Manter member dependente das permissões da função atribuída (ex.: SDR).
-- 4) Manter o mesmo contrato entre has_organization_permission e Stage 5.

BEGIN;

CREATE OR REPLACE FUNCTION public.has_organization_permission(p_permission_key text)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_member public.organization_members%ROWTYPE;
BEGIN
  IF public.is_platform_owner() THEN RETURN true; END IF;

  SELECT * INTO v_member
    FROM public.organization_members m
   WHERE m.organization_members_id=public.current_organization_member_id()
     AND m.status_id=1;

  IF v_member.organization_members_id IS NULL THEN RETURN false; END IF;

  -- O Dono possui tudo dentro da organização, exceto permissões explicitamente
  -- reservadas ao escopo global da plataforma.
  IF v_member.access_level='owner' THEN
    RETURN EXISTS(
      SELECT 1 FROM public.permissions p
       WHERE p.permissions_key=p_permission_key
         AND p.permissions_sensitivity<>'platform_only'
    );
  END IF;

  -- O nível Gestor é uma garantia estrutural da plataforma. A função atribuída
  -- pode acrescentar permissões, mas não remove o mínimo necessário para operar
  -- e administrar o CRM no dia a dia.
  IF v_member.access_level='manager' AND p_permission_key = ANY(ARRAY[
    'organization.view',
    'members.view','members.invite','members.edit','members.deactivate',
    'roles.view','audit.view',
    'leads.view','leads.create','leads.edit','leads.validate','leads.assign',
    'queues.view','queues.prepare','queues.control',
    'capture.use','capture.approve','capture.block','capture.settings',
    'whatsapp.view','whatsapp.reply','whatsapp.assign','whatsapp.dispatch','whatsapp.instances.manage','whatsapp.settings',
    'instagram.view','instagram.use','instagram.settings',
    'templates.view','templates.manage',
    'tools.view','tools.manage',
    'settings.view','settings.manage',
    'monitoring.view'
  ]) THEN
    RETURN EXISTS(
      SELECT 1 FROM public.permissions p
       WHERE p.permissions_key=p_permission_key
         AND p.permissions_sensitivity<>'platform_only'
    );
  END IF;

  RETURN EXISTS(
    SELECT 1
      FROM public.organization_role_permissions rp
      JOIN public.permissions p ON p.permissions_id=rp.permissions_id
     WHERE rp.organization_roles_id=v_member.organization_roles_id
       AND p.permissions_key=p_permission_key
       AND p.permissions_sensitivity='delegable'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.stage5_member_has_permission(
  p_organizations_id bigint,
  p_organization_members_id bigint,
  p_permission text
)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT EXISTS(
    SELECT 1
      FROM public.organization_members m
     WHERE m.organization_members_id=p_organization_members_id
       AND m.organizations_id=p_organizations_id
       AND m.status_id=1
       AND (
         m.access_level='owner'
         OR (
           m.access_level='manager'
           AND p_permission=ANY(ARRAY[
             'organization.view',
             'members.view','members.invite','members.edit','members.deactivate',
             'roles.view','audit.view',
             'leads.view','leads.create','leads.edit','leads.validate','leads.assign',
             'queues.view','queues.prepare','queues.control',
             'capture.use','capture.approve','capture.block','capture.settings',
             'whatsapp.view','whatsapp.reply','whatsapp.assign','whatsapp.dispatch','whatsapp.instances.manage','whatsapp.settings',
             'instagram.view','instagram.use','instagram.settings',
             'templates.view','templates.manage',
             'tools.view','tools.manage',
             'settings.view','settings.manage',
             'monitoring.view'
           ])
           AND EXISTS(
             SELECT 1 FROM public.permissions gp
              WHERE gp.permissions_key=p_permission
                AND gp.permissions_sensitivity<>'platform_only'
           )
         )
         OR EXISTS(
           SELECT 1
             FROM public.organization_role_permissions rp
             JOIN public.permissions p ON p.permissions_id=rp.permissions_id
            WHERE rp.organization_roles_id=m.organization_roles_id
              AND p.permissions_key=p_permission
              AND p.permissions_sensitivity='delegable'
         )
       )
  );
$function$;

COMMENT ON FUNCTION public.has_organization_permission(text) IS
'FIX37: Owner total no tenant; Manager possui mínimo operacional/administrativo garantido; Member depende da função atribuída.';
COMMENT ON FUNCTION public.stage5_member_has_permission(bigint,bigint,text) IS
'FIX37: espelha a matriz Owner/Manager/Member usada pelo CRM nas rotas Stage 5.';

COMMIT;
