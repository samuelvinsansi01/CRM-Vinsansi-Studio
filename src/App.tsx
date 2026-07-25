import { useState } from 'react';
import { useAuth } from './app/providers/AuthProvider';
import { modules, type ModuleId } from './modules/registry';
import { ModulePlaceholder } from './shared/components/ModulePlaceholder';

export function App() {
  const auth = useAuth();
  const [active, setActive] = useState<ModuleId>('leads');
  const module = modules.find((item) => item.id === active) ?? modules[0];

  if (auth.loading) return <main className="center"><p>Carregando...</p></main>;

  return <div className="app-shell">
    <aside>
      <div><span className="eyebrow">Painel CRM</span><h1>Nova base</h1><p className="muted">Arquitetura limpa para o banco novo.</p></div>
      <nav>{modules.map((item) => <button className={active === item.id ? 'active' : ''} key={item.id} onClick={() => setActive(item.id)}>{item.title}</button>)}</nav>
      <div className="status"><strong>Supabase</strong><span>{auth.configured ? 'Configurado' : 'Configure o .env'}</span>{auth.appUser ? <small>users_id: {auth.appUser.users_id}</small> : null}</div>
    </aside>
    <main>
      <header><div><span className="eyebrow">Reconstrução controlada</span><h1>{module.title}</h1></div>{auth.session ? <button className="secondary" onClick={() => void auth.signOut()}>Sair</button> : null}</header>
      {!auth.configured ? <section className="notice"><strong>Configuração pendente</strong><p>Copie <code>.env.example</code> para <code>.env</code> e informe URL e chave anônima do Supabase.</p></section> : null}
      <ModulePlaceholder {...module} />
      <section className="card"><h2>Próximo passo</h2><p>Implementar este módulo com repository, service, hooks e componentes próprios, usando somente as tabelas novas.</p></section>
    </main>
  </div>;
}
