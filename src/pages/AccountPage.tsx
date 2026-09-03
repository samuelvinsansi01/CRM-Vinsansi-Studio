import { Camera, KeyRound, Save, Trash2, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Button, Field, Panel, ToastViewport, type ToastItem } from '../design-system/components';
import { PageHeader } from '../design-system/layouts/PageHeader';
import { useAuthContext } from '../providers/AuthProvider';
import { MAX_PROFILE_IMAGE_BYTES, PROFILE_IMAGE_TYPES, updateCurrentUserProfile } from '../services/auth/userProfile.service';

function pushTemporaryToast(
  setToasts: Dispatch<SetStateAction<ToastItem[]>>,
  toast: Omit<ToastItem, 'id'>,
) {
  const id = crypto.randomUUID?.() ?? String(Date.now());
  setToasts((current) => [...current, { id, ...toast }]);
  window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 3600);
}

export function AccountPage() {
  const { user, refreshProfile, updatePassword } = useAuthContext();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState(user?.name ?? '');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [saving, setSaving] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    setName(user?.name ?? '');
  }, [user?.name]);

  const previewUrl = useMemo(() => {
    if (!avatarFile) return user?.avatarUrl ?? null;
    return URL.createObjectURL(avatarFile);
  }, [avatarFile, user?.avatarUrl]);

  useEffect(() => {
    return () => {
      if (previewUrl?.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const initials = (name.trim() || user?.email || 'U')
    .split(/\s+/)
    .slice(0, 2)
    .map((item) => item[0]?.toUpperCase())
    .join('');

  const chooseImage = (file: File | null) => {
    if (!file) return;
    if (!PROFILE_IMAGE_TYPES.includes(file.type as typeof PROFILE_IMAGE_TYPES[number])) {
      pushTemporaryToast(setToasts, { title: 'Formato inválido', description: 'Use uma imagem JPG, PNG ou WebP.', tone: 'danger' });
      return;
    }
    if (file.size > MAX_PROFILE_IMAGE_BYTES) {
      pushTemporaryToast(setToasts, { title: 'Imagem muito grande', description: 'O limite é de 5 MB.', tone: 'danger' });
      return;
    }
    setAvatarFile(file);
    setRemoveAvatar(false);
  };

  const save = async () => {
    if (!user) return;
    setSaving(true);
    try {
      await updateCurrentUserProfile({ name, avatarFile, removeAvatar });
      await refreshProfile();
      setAvatarFile(null);
      setRemoveAvatar(false);
      pushTemporaryToast(setToasts, {
        title: 'Perfil atualizado',
        description: 'O nome e a imagem já foram atualizados no cabeçalho.',
        tone: 'success',
      });
    } catch (error) {
      pushTemporaryToast(setToasts, {
        title: 'Não foi possível salvar',
        description: error instanceof Error ? error.message : 'Tente novamente.',
        tone: 'danger',
      });
    } finally {
      setSaving(false);
    }
  };


  const savePassword = async () => {
    if (password.length < 8) {
      pushTemporaryToast(setToasts, {
        title: 'Senha muito curta',
        description: 'Use pelo menos 8 caracteres.',
        tone: 'danger',
      });
      return;
    }
    if (password !== confirmPassword) {
      pushTemporaryToast(setToasts, {
        title: 'Senhas diferentes',
        description: 'A confirmação precisa ser igual à nova senha.',
        tone: 'danger',
      });
      return;
    }

    setSavingPassword(true);
    try {
      await updatePassword(password);
      setPassword('');
      setConfirmPassword('');
      pushTemporaryToast(setToasts, {
        title: 'Senha atualizada',
        description: 'Você já pode usar este e-mail e senha para entrar no CRM e no app.',
        tone: 'success',
      });
    } catch (error) {
      pushTemporaryToast(setToasts, {
        title: 'Não foi possível alterar a senha',
        description: error instanceof Error ? error.message : 'Tente novamente ou use “Esqueci minha senha” no login.',
        tone: 'danger',
      });
    } finally {
      setSavingPassword(false);
    }
  };

  const clearImage = () => {
    setAvatarFile(null);
    setRemoveAvatar(true);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="settings-page account-page">
      <PageHeader
        title="Minha conta"
        description="Atualize seu perfil e a senha usada para entrar nos produtos Vinsansi."
        action={<Button iconLeft={Save} loading={saving} onClick={save}>Salvar alterações</Button>}
      />

      <Panel title="Perfil" className="settings-card account-card">
        <div className="account-profile-grid">
          <section className="account-avatar-section" aria-label="Imagem de perfil">
            <div
              className={`account-avatar ${previewUrl && !removeAvatar ? 'account-avatar--image' : ''}`}
              style={previewUrl && !removeAvatar ? { backgroundImage: `url(${previewUrl})` } : undefined}
              aria-label="Prévia da imagem de perfil"
            >
              {!previewUrl || removeAvatar ? <span>{initials}</span> : null}
              <Camera size={24} strokeWidth={1.8} aria-hidden="true" />
            </div>
            <div className="account-avatar-actions">
              <input
                ref={inputRef}
                className="sr-only"
                type="file"
                accept={PROFILE_IMAGE_TYPES.join(',')}
                onChange={(event) => chooseImage(event.target.files?.[0] ?? null)}
              />
              <Button variant="secondary" iconLeft={Upload} onClick={() => inputRef.current?.click()}>
                Escolher imagem
              </Button>
              {(user?.avatarPath || avatarFile) && !removeAvatar ? (
                <Button variant="ghost" iconLeft={Trash2} onClick={clearImage}>Remover</Button>
              ) : null}
            </div>
            <p className="account-help">JPG, PNG ou WebP. Tamanho máximo de 5 MB.</p>
          </section>

          <section className="account-fields-section">
            <Field label="Nome" value={name} maxLength={120} onChange={setName} placeholder="Seu nome" />
            <Field label="E-mail" value={user?.email ?? ''} readOnly />
            <div className="account-storage-note">
              <strong>Armazenamento privado</strong>
              <span>A imagem fica no Supabase Storage e o banco salva somente o caminho do arquivo.</span>
            </div>
          </section>
        </div>
      </Panel>

      <Panel title="Segurança" className="settings-card account-card account-security-card">
        <div className="account-security-grid">
          <div className="account-security-copy">
            <div className="account-security-icon"><KeyRound size={20} strokeWidth={1.8} /></div>
            <div>
              <strong>Senha de acesso</strong>
              <p>Defina ou altere uma senha para entrar com <b>{user?.email ?? 'seu e-mail'}</b> no CRM e no app. O login com Google continua disponível como alternativa.</p>
            </div>
          </div>
          <div className="account-security-fields">
            <Field label="Nova senha" type="password" value={password} onChange={setPassword} autoComplete="new-password" placeholder="Mínimo de 8 caracteres" />
            <Field label="Confirmar nova senha" type="password" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" placeholder="Repita a nova senha" />
            <div className="account-security-actions">
              <span>Sua senha é gerenciada pelo Supabase Auth e não é armazenada nas tabelas do CRM.</span>
              <Button iconLeft={KeyRound} loading={savingPassword} disabled={savingPassword || !password || !confirmPassword} onClick={savePassword}>Salvar senha</Button>
            </div>
          </div>
        </div>
      </Panel>

      <ToastViewport toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((item) => item.id !== id))} />
    </div>
  );
}
