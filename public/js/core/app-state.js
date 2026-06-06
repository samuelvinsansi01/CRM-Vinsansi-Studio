window.CRMState = (() => {
  const state = {
    user: null,
    session: null,
    bootstrap: null,
    activePage: 'dashboard'
  };

  function set(patch) {
    Object.assign(state, patch || {});
    window.dispatchEvent(new CustomEvent('crm:state-change', { detail: { ...state } }));
  }

  function get() {
    return { ...state };
  }

  return { get, set };
})();
