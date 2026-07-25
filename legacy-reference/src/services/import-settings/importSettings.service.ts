import { eventBus } from '../../lib/events';
import { repositories } from '../../repositories';
import type { BranchConfigRecord, ConfigRecord } from '../config/types';
import type { ImportBranchRule, ImportSettings, UpdateImportSettingsInput } from './types';

function isBranch(record: ConfigRecord): record is BranchConfigRecord {
  return record.kind === 'branches';
}

function branchToRule(branch: BranchConfigRecord): ImportBranchRule {
  return {
    id: branch.id,
    branchId: branch.id,
    branchSlug: branch.slug,
    branch: branch.name,
    subcategories: branch.subcategories,
    associatedCategories: branch.associatedCategories,
    minRating: branch.minRating,
    minReviews: branch.minReviews,
    enabled: branch.active,
  };
}

async function getBranchRulesFromConfig(fallbackRules: ImportBranchRule[]) {
  const branches = (await repositories.config.list('branches')).filter(isBranch);
  return branches.length ? branches.map(branchToRule) : fallbackRules;
}

async function composeSettings(settings: ImportSettings): Promise<ImportSettings> {
  return {
    ...settings,
    branchRules: await getBranchRulesFromConfig(settings.branchRules),
  };
}

async function syncBranchRules(input: UpdateImportSettingsInput) {
  if (!input.branchRules?.length) return;

  const branches = (await repositories.config.list('branches')).filter(isBranch);
  const branchesById = new Map(branches.map((branch) => [branch.id, branch]));

  await Promise.all(
    input.branchRules.map((rule) => {
      const branch = branchesById.get(rule.id);
      if (!branch) return Promise.resolve();

      return repositories.config.update('branches', branch.id, {
        ...branch,
        minRating: rule.minRating,
        minReviews: rule.minReviews,
        active: rule.enabled,
        status: rule.enabled ? 'Ativo' : 'Inativo',
        subcategories: rule.subcategories,
      });
    }),
  );
}

export const importSettingsService = {
  async get() {
    return composeSettings(await repositories.settings.getImportSettings());
  },

  async update(input: UpdateImportSettingsInput) {
    await syncBranchRules(input);
    const nextSettings = await repositories.settings.updateImportSettings(input);
    const composedSettings = await composeSettings(nextSettings);
    eventBus.emit('import-settings:changed', { source: 'settings' });
    return composedSettings;
  },

  async reset() {
    const nextSettings = await repositories.settings.resetImportSettings();
    const composedSettings = await composeSettings(nextSettings);
    eventBus.emit('import-settings:changed', { source: 'reset' });
    return composedSettings;
  },
};
