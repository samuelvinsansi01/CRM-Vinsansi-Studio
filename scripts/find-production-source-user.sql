-- Execute esta consulta separadamente no SQL Editor da PRODUCAO.
-- Ela e somente leitura e serve apenas para escolher o source_users_id correto.
SELECT
  u.users_id AS source_users_id,
  u.users_name,
  u.status_id,
  u.auth_user_id,
  au.email AS auth_email,
  au.raw_user_meta_data ->> 'full_name' AS auth_full_name,
  u.users_created_at
FROM public.users AS u
JOIN auth.users AS au
  ON au.id = u.auth_user_id
ORDER BY
  lower(coalesce(au.email, '')),
  u.users_id;
