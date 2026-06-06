(function () {
  'use strict';

  const db = () => window.crmSupabase || window.supabaseClient || window.CRM?.supabase;

  function getClient() {
    const client = db();
    if (!client || !client.auth) throw new Error('Supabase client não foi inicializado. Verifique env.js e ordem dos scripts.');
    return client;
  }

  async function getSession() {
    const { data, error } = await getClient().auth.getSession();
    if (error) throw error;
    return data.session || null;
  }

  async function getUser() {
    const { data, error } = await getClient().auth.getUser();
    if (error) return null;
    return data.user || null;
  }

  function profilePayloadFromUser(user) {
    const meta = user?.user_metadata || {};
    return {
      id: user.id,
      email: user.email || meta.email || null,
      display_name: meta.full_name || meta.name || user.email || 'Usuário',
      role: 'owner'
    };
  }

  async function ensureProfile() {
    const user = await getUser();
    if (!user) return null;

    const payload = profilePayloadFromUser(user);

    const { data, error } = await getClient()
      .from('profiles')
      .upsert(payload, { onConflict: 'id' })
      .select('id,email,display_name,role,created_at')
      .maybeSingle();

    if (error) {
      console.warn('Não foi possível criar/atualizar profile automaticamente:', error);
      return payload;
    }

    return data || payload;
  }

  async function getProfile() {
    const user = await getUser();
    if (!user) return null;

    const { data, error } = await getClient()
      .from('profiles')
      .select('id,email,display_name,role,created_at')
      .eq('id', user.id)
      .maybeSingle();

    if (error) {
      console.warn('Erro ao buscar profile. Usando dados da sessão:', error);
      return profilePayloadFromUser(user);
    }

    if (!data) return ensureProfile();
    return data;
  }

  async function signInWithGoogle() {
    const redirectTo = window.location.origin + window.location.pathname + '#dashboard';
    const { error } = await getClient().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo }
    });
    if (error) throw error;
  }

  async function signOut() {
    const { error } = await getClient().auth.signOut();
    if (error) throw error;
    window.location.href = window.location.origin + window.location.pathname;
  }

  function onAuthChange(callback) {
    return getClient().auth.onAuthStateChange((_event, session) => callback(session));
  }

  window.AuthService = {
    getSession,
    getUser,
    getProfile,
    ensureProfile,
    signInWithGoogle,
    signOut,
    onAuthChange
  };
})();
