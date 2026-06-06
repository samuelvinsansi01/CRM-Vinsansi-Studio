import { rpc } from './database.service.js';

export async function importLead(payload) {
  return rpc('rpc_import_lead', { p_payload: payload });
}

export async function importManyLeads(rows, onProgress = () => {}) {
  const result = { imported: 0, failed: 0, errors: [] };
  for (let i = 0; i < rows.length; i += 1) {
    try {
      await importLead(rows[i]);
      result.imported += 1;
    } catch (error) {
      result.failed += 1;
      result.errors.push({ index: i, message: error.message, row: rows[i] });
    }
    onProgress({ ...result, total: rows.length, current: i + 1 });
  }
  return result;
}
