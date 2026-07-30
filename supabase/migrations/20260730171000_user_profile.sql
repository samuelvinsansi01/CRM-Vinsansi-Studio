BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS users_name text,
  ADD COLUMN IF NOT EXISTS users_avatar_path text;

UPDATE public.users AS app_user
SET users_name = COALESCE(
  NULLIF(BTRIM(auth_user.raw_user_meta_data ->> 'full_name'), ''),
  NULLIF(BTRIM(auth_user.raw_user_meta_data ->> 'name'), ''),
  NULLIF(SPLIT_PART(COALESCE(auth_user.email, ''), '@', 1), ''),
  'Usuário'
)
FROM auth.users AS auth_user
WHERE auth_user.id = app_user.auth_user_id
  AND NULLIF(BTRIM(COALESCE(app_user.users_name, '')), '') IS NULL;

COMMENT ON COLUMN public.users.users_name IS 'Nome de exibição editável do usuário interno.';
COMMENT ON COLUMN public.users.users_avatar_path IS 'Caminho privado do avatar no bucket profile-images.';

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'profile-images',
  'profile-images',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS profile_images_select_own ON storage.objects;
CREATE POLICY profile_images_select_own
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'profile-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS profile_images_insert_own ON storage.objects;
CREATE POLICY profile_images_insert_own
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'profile-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS profile_images_update_own ON storage.objects;
CREATE POLICY profile_images_update_own
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'profile-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'profile-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS profile_images_delete_own ON storage.objects;
CREATE POLICY profile_images_delete_own
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'profile-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

COMMIT;
