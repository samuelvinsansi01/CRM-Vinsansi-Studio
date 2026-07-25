function envFlag(value: unknown, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  return String(value).toLowerCase() === 'true';
}

export const runtimeFlags = {
  enableDemoData: envFlag(import.meta.env.VITE_ENABLE_DEMO_DATA, false),
};
