import { FormEvent, useState } from 'react';
import { Chrome, LogIn } from 'lucide-react';
import { Button, Field } from '../design-system/components';
import { useAuthContext } from '../providers/AuthProvider';

export function LoginPage() {
  const { signIn, signInWithGoogle, error } = useAuthContext();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [localError, setLocalError] = useState('');

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLocalError('');

    if (!email.trim() || !password) {
      setLocalError('Informe email e senha.');
      return;
    }

    setLoading(true);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Nao foi possivel entrar.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLocalError('');
    setGoogleLoading(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Nao foi possivel entrar com Google.');
      setGoogleLoading(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-panel" onSubmit={handleSubmit}>
        <div className="login-panel__header">
          <strong>Vinsansi Studio</strong>
          <span>Acesse o painel operacional</span>
        </div>
        <Field label="Email" type="email" placeholder="email@empresa.com" value={email} onChange={setEmail} autoComplete="email" />
        <Field label="Senha" type="password" placeholder="Senha" value={password} onChange={setPassword} autoComplete="current-password" />
        {localError || error ? <div className="login-panel__error">{localError || error}</div> : null}
        <Button iconLeft={LogIn} loading={loading} disabled={loading} type="submit">Entrar</Button>
        <div className="login-panel__divider">ou</div>
        <Button iconLeft={Chrome} variant="secondary" loading={googleLoading} disabled={loading || googleLoading} type="button" onClick={handleGoogleLogin}>
          Entrar com Google
        </Button>
      </form>
    </div>
  );
}
