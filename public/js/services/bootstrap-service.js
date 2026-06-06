window.BootstrapService = (() => {
  async function load() {
    const data = await window.DbClient.rpc('rpc_get_app_bootstrap');
    window.CRMState.set({ bootstrap: data });
    return data;
  }

  return { load };
})();
