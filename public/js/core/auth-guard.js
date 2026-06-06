window.AuthGuard = (() => {
  function qs(id) { return document.getElementById(id); }

  async function getSession() {
    const { data, error } = await window.CRMDb.getClient().auth.getSession();
    if (error) throw error;
    return data.session || null;
  }

  async function signInWithGoogle() {
    const cfg = window.CRM_CONFIG || {};
    const redirectTo = `${window.location.origin}${cfg.loginRedirectPath || '/index.html'}`;
    const { error } = await window.CRMDb.getClient().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo }
    });
    if (error) throw error;
  }

  async function signOut() {
    await window.CRMDb.getClient().auth.signOut();
    window.location.reload();
  }

  function renderAuth(session) {
    const loggedOut = qs('authLoggedOut');
    const appShell = qs('appShell');
    const userEmail = qs('userEmail');

    if (loggedOut) loggedOut.hidden = !!session;
    if (appShell) appShell.hidden = !session;
    if (userEmail) userEmail.textContent = session?.user?.email || '';
  }

  async function init() {
    const session = await getSession();
    window.CRMState.set({ session, user: session?.user || null });
    renderAuth(session);

    const loginBtn = qs('btnGoogleLogin');
    const logoutBtn = qs('btnLogout');
    if (loginBtn) loginBtn.onclick = signInWithGoogle;
    if (logoutBtn) logoutBtn.onclick = signOut;

    window.CRMDb.getClient().auth.onAuthStateChange((_event, newSession) => {
      window.CRMState.set({ session: newSession, user: newSession?.user || null });
      renderAuth(newSession);
    });

    return session;
  }

  return { init, getSession, signInWithGoogle, signOut };
})();
