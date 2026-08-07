import { importSettingsService } from '../import-settings';

export type ImportPersistenceDecision = {
  allowed: boolean;
  simulation: boolean;
  reason: 'simulation_mode' | 'preview_only' | null;
};

export async function guardImportPersistence(previewOnly = false): Promise<ImportPersistenceDecision> {
  const settings = await importSettingsService.get();
  const simulation = settings.safeMode.simulationMode || previewOnly;

  return {
    allowed: !simulation,
    simulation,
    reason: settings.safeMode.simulationMode
      ? 'simulation_mode'
      : previewOnly
        ? 'preview_only'
        : null,
  };
}
