window.SettingsService = (() => {
  async function getDispatchDefaults() {
    return window.SettingsRepository.get('dispatch', 'default_batches');
  }

  async function saveDispatchDefaults(value) {
    return window.SettingsRepository.upsert('dispatch', 'default_batches', value);
  }

  return { getDispatchDefaults, saveDispatchDefaults };
})();
