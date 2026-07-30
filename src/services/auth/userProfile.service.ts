import { getSupabaseClient } from '../../lib/supabase';
import { getCurrentPublicUser } from './publicUser.service';

export const PROFILE_IMAGES_BUCKET = 'profile-images';
export const MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024;
export const PROFILE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type UserProfileUpdate = {
  name: string;
  avatarFile?: File | null;
  removeAvatar?: boolean;
};

function validateName(value: string) {
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length < 2) throw new Error('Informe um nome com pelo menos 2 caracteres.');
  if (name.length > 120) throw new Error('O nome pode ter no máximo 120 caracteres.');
  return name;
}

function validateAvatar(file: File) {
  if (!PROFILE_IMAGE_TYPES.includes(file.type as typeof PROFILE_IMAGE_TYPES[number])) {
    throw new Error('Use uma imagem JPG, PNG ou WebP.');
  }
  if (file.size > MAX_PROFILE_IMAGE_BYTES) {
    throw new Error('A imagem pode ter no máximo 5 MB.');
  }
}

export async function createProfileAvatarUrl(path: string | null | undefined) {
  if (!path) return null;

  const { data, error } = await getSupabaseClient()
    .storage
    .from(PROFILE_IMAGES_BUCKET)
    .createSignedUrl(path, 60 * 60 * 24);

  if (error || !data?.signedUrl) return null;
  return `${data.signedUrl}${data.signedUrl.includes('?') ? '&' : '?'}v=${Date.now()}`;
}

export async function updateCurrentUserProfile(input: UserProfileUpdate) {
  const client = getSupabaseClient();
  const publicUser = await getCurrentPublicUser();
  const { data: authData, error: authError } = await client.auth.getUser();

  if (authError || !authData.user) {
    throw new Error(authError?.message ?? 'Usuário não autenticado.');
  }

  const name = validateName(input.name);
  const avatarPath = `${authData.user.id}/avatar`;
  let nextAvatarPath: string | null | undefined;

  if (input.avatarFile) {
    validateAvatar(input.avatarFile);
    const { error: uploadError } = await client.storage
      .from(PROFILE_IMAGES_BUCKET)
      .upload(avatarPath, input.avatarFile, {
        upsert: true,
        cacheControl: '0',
        contentType: input.avatarFile.type,
      });

    if (uploadError) {
      throw new Error(`Não foi possível enviar a imagem: ${uploadError.message}`);
    }
    nextAvatarPath = avatarPath;
  } else if (input.removeAvatar) {
    const storedAvatarPath = publicUser.users_avatar_path || avatarPath;
    const { error: removeError } = await client.storage
      .from(PROFILE_IMAGES_BUCKET)
      .remove([storedAvatarPath]);

    if (removeError && !/not found/i.test(removeError.message)) {
      throw new Error(`Não foi possível remover a imagem: ${removeError.message}`);
    }
    nextAvatarPath = null;
  }

  const patch: Record<string, unknown> = {
    users_name: name,
    users_updated_at: new Date().toISOString(),
  };
  if (nextAvatarPath !== undefined) patch.users_avatar_path = nextAvatarPath;

  const { data: updated, error: updateError } = await client
    .from('users')
    .update(patch)
    .eq('users_id', publicUser.users_id)
    .eq('auth_user_id', authData.user.id)
    .select('users_id, auth_user_id, status_id, users_name, users_avatar_path')
    .single();

  if (updateError) {
    throw new Error(`Não foi possível atualizar o perfil: ${updateError.message}`);
  }

  const { error: metadataError } = await client.auth.updateUser({
    data: { full_name: name, name },
  });
  if (metadataError) {
    console.warn('Perfil salvo em public.users, mas os metadados do Auth não foram atualizados.', metadataError);
  }

  return updated as {
    users_id: string | number;
    auth_user_id: string;
    status_id: string | number;
    users_name: string | null;
    users_avatar_path: string | null;
  };
}
