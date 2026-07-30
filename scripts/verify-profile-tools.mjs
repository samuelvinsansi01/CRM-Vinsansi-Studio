import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

const migration = read('supabase/migrations/20260730171000_user_profile.sql');
const auth = read('src/providers/AuthProvider.tsx');
const header = read('src/design-system/layouts/Header.tsx');
const account = read('src/pages/AccountPage.tsx');
const tools = read('src/pages/ToolsPage.tsx');
const profileService = read('src/services/auth/userProfile.service.ts');
const styles = read('src/styles/components.css');
const manifest = JSON.parse(read('public/tools/manifest.json'));

assert(migration.includes('users_name') && migration.includes('users_avatar_path'), 'Migration não adiciona nome/avatar em users.');
assert(migration.includes("'profile-images'") && migration.includes('storage.objects'), 'Migration não cria bucket/policies do avatar.');
assert(profileService.includes(".storage\n    .from(PROFILE_IMAGES_BUCKET)") || profileService.includes('.storage\n      .from(PROFILE_IMAGES_BUCKET)'), 'Serviço de perfil não usa Supabase Storage.');
assert(profileService.includes(".from('users')"), 'Serviço de perfil não atualiza public.users.');
assert(auth.includes('users_name') && auth.includes('users_avatar_path') && auth.includes('avatarUrl'), 'AuthProvider não usa o perfil canônico.');
assert(header.includes("navigate('account')") && header.includes('user?.avatarUrl'), 'Cabeçalho não usa Minha conta/avatar dinâmico.');
assert(account.includes('updateCurrentUserProfile') && account.includes('Escolher imagem'), 'Página Minha conta incompleta.');
assert(tools.includes('/tools/manifest.json') && tools.includes('Baixar ZIP'), 'Página Ferramentas não usa manifesto/download.');
assert(!styles.includes('.nav-link--active'), 'Menu pai ainda possui estilo ativo.');
assert(styles.includes('.nav-link:hover') && styles.includes('background: transparent'), 'Hover do menu pai não foi neutralizado.');
assert(Array.isArray(manifest.tools) && manifest.tools.length >= 2, 'Manifesto precisa publicar Worker e Extensão.');
for (const tool of manifest.tools) {
  assert(exists(tool.path.replace(/^\//, 'public/')), `Pacote ausente: ${tool.path}`);
  assert(/latest\.zip$/.test(tool.path), `Pacote sem caminho estável latest: ${tool.path}`);
}

if (failures.length) {
  console.error(`Falhas de perfil/ferramentas (${failures.length}):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('OK: perfil, avatar privado, ferramentas latest e menu pai neutro validados.');
