import { FormEvent, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { Button, Field } from '../design-system/components';
import { useAuthContext } from '../providers/AuthProvider';

export function PasswordRecoveryPage() {
  const { completePasswordRecovery, error } = useAuthContext();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState('');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLocalError('');
    if (password.length < 8) {
      setLocalError('A senha deve ter pelo menos 8 caracteres.');
      return;
    }
    if (password !== confirmPassword) {
      setLocalError('As senhas não coincidem.');
      return;
    }
    setLoading(true);
    try {
      await completePasswordRecovery(password);
      window.location.assign(window.location.pathname);
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : 'Não foi possível redefinir a senha.');
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-panel" onSubmit={submit}>
        <div className="login-panel__header">
          <strong>Criar nova senha</strong>
          <span>Defina a senha que será usada no CRM e nos aplicativos Vinsansi.</span>
        </div>
        <Field label="Nova senha" type="password" value={password} onChange={setPassword} autoComplete="new-password" />
        <Field label="Confirmar nova senha" type="password" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" />
        <p className="login-panel__hint">Use pelo menos 8 caracteres.</p>
        {localError || error ? <div className="login-panel__error">{localError || error}</div> : null}
        <Button iconLeft={KeyRound} loading={loading} disabled={loading} type="submit">Salvar nova senha</Button>
      </form>
    </div>
  );
}
