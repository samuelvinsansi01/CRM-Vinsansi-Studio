-- R59 BUILD FIX 42 - checagem estrutural da RPC de Dashboard.
DO $$
DECLARE
  v_src text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO v_src
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.proname='dashboard_summary_r59'
    AND pg_get_function_identity_arguments(p.oid)='p_from timestamp with time zone, p_to_exclusive timestamp with time zone';

  IF v_src IS NULL THEN RAISE EXCEPTION 'dashboard_summary_r59 ausente'; END IF;
  IF position('R59-FIX42' in v_src)=0 THEN RAISE EXCEPTION 'dashboard_summary_r59 ainda nao esta no contrato FIX42'; END IF;
  IF position('l.lead_status_id=4' in replace(v_src,' ',''))=0 THEN RAISE EXCEPTION 'Na fila nao esta sendo calculado como estado atual'; END IF;
  IF position('receivableTotal' in v_src)=0 THEN RAISE EXCEPTION 'Saldo total a receber ausente do contrato'; END IF;
END $$;

SELECT public.dashboard_summary_r59(
  date_trunc('week', now()),
  date_trunc('week', now()) + interval '7 days'
) AS dashboard_fix42;
