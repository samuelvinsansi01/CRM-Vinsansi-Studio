import { FormEvent, useState } from 'react';
import { ArrowLeft, Chrome, LogIn, Mail } from 'lucide-react';
import { Button, Field } from '../design-system/components';
import { useAuthContext } from '../providers/AuthProvider';

export function LoginPage() {
  const { signIn, signInWithGoogle, requestPasswordReset, error } = useAuthContext();
  const [mode, setMode] = useState<'login' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [localError, setLocalError] = useState('');
  const [message, setMessage] = useState('');

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLocalError('');
    setMessage('');

    if (mode === 'forgot') {
      if (!email.trim()) {
        setLocalError('Informe seu e-mail.');
        return;
      }
      setLoading(true);
      try {
        await requestPasswordReset(email);
        setMessage('Se o e-mail estiver cadastrado, você receberá um link para criar uma nova senha.');
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : 'Não foi possível enviar o link de recuperação.');
      } finally {
        setLoading(false);
      }
      return;
    }

    if (!email.trim() || !password) {
      setLocalError('Informe e-mail e senha.');
      return;
    }

    setLoading(true);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Não foi possível entrar.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLocalError('');
    setMessage('');
    setGoogleLoading(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Não foi possível entrar com Google.');
      setGoogleLoading(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-panel" onSubmit={handleSubmit}>
        <div className="login-panel__header">
          <strong>Vinsansi Studio</strong>
          <span>{mode === 'forgot' ? 'Recupere o acesso por e-mail' : 'Acesse o painel operacional'}</span>
        </div>
        <Field label="E-mail" type="email" placeholder="email@empresa.com" value={email} onChange={setEmail} autoComplete="email" />
        {mode === 'login' ? (
          <Field label="Senha" type="password" placeholder="Senha" value={password} onChange={setPassword} autoComplete="current-password" />
        ) : null}
        {message ? <div className="login-panel__success">{message}</div> : null}
        {localError || error ? <div className="login-panel__error">{localError || error}</div> : null}

        {mode === 'login' ? (
          <>
            <button className="login-panel__link" type="button" onClick={() => { setMode('forgot'); setLocalError(''); setMessage(''); }}>
              Esqueci minha senha
            </button>
            <Button iconLeft={LogIn} loading={loading} disabled={loading} type="submit">Entrar</Button>
            <div className="login-panel__divider">ou</div>
            <Button iconLeft={Chrome} variant="secondary" loading={googleLoading} disabled={loading || googleLoading} type="button" onClick={handleGoogleLogin}>
              Entrar com Google
            </Button>
          </>
        ) : (
          <>
            <Button iconLeft={Mail} loading={loading} disabled={loading} type="submit">Enviar link de recuperação</Button>
            <Button iconLeft={ArrowLeft} variant="ghost" type="button" onClick={() => { setMode('login'); setLocalError(''); setMessage(''); }}>
              Voltar ao login
            </Button>
          </>
        )}
      </form>
    </div>
  );
}
