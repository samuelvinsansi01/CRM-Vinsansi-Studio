(function () {
  'use strict';

  const db = () => window.crmSupabase;

  async function getSession() {
    const { data, error } = await db().auth.getSession();
    if (error) throw error;
    return data.session || null;
  }

  async function getUser() {
    const { data, error } = await db().auth.getUser();
    if (error) return null;
    return data.user || null;
  }

  async function getProfile() {
    const user = await getUser();
    if (!user) return null;

    const { data, error } = await db()
      .from('profiles')
      .select('id,email,display_name,role,created_at')
      .eq('id', user.id)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async function signInWithGoogle() {
    const redirectTo = window.location.origin + window.location.pathname;
    const { error } = await db().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo }
    });
    if (error) throw error;
  }

  async function signOut() {
    const { error } = await db().auth.signOut();
    if (error) throw error;
    window.location.reload();
  }

  function onAuthChange(callback) {
    return db().auth.onAuthStateChange((_event, session) => callback(session));
  }

  window.AuthService = {
    getSession,
    getUser,
    getProfile,
    signInWithGoogle,
    signOut,
    onAuthChange
  };
})();
