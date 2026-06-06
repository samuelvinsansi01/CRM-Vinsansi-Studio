window.SettingsRepository = (() => {
  async function ensureDefaults() {
    return window.DbClient.rpc('rpc_ensure_default_settings');
  }

  async function get(scope, key) {
    return window.DbClient.rpc('rpc_get_user_setting', { p_scope: scope, p_key: key });
  }

  async function upsert(scope, key, value) {
    return window.DbClient.rpc('rpc_upsert_user_setting', { p_scope: scope, p_key: key, p_value: value || {} });
  }

  return { ensureDefaults, get, upsert };
})();
