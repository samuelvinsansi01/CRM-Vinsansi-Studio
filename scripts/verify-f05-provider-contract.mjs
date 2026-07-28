import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const ts = require('typescript');

const sourcePath = path.join(process.cwd(), 'api/whatsapp/validation.handler.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const javascript = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
const runtimeModule = new Module(sourcePath);
runtimeModule.filename = sourcePath;
runtimeModule.paths = Module._nodeModulePaths(process.cwd());
runtimeModule._compile(javascript, `${sourcePath}.js`);
const { runStrictValidation } = runtimeModule.exports;

process.env.WHATSAPP_VALIDATION_WORKER_URL = 'https://worker.test';
process.env.WHATSAPP_VALIDATION_WORKER_TOKEN = 'worker-secret';
process.env.WHATSAPP_VALIDATION_TIMEOUT_MS = '5000';

const leads = [{ id: '10', lead_id: '10', company: 'Empresa', normalized_phone: '5511999999999', chip_instance: 'chip-1' }];

let captured;
globalThis.fetch = async (_url, init) => {
  captured = JSON.parse(String(init.body));
  return {
    ok: true,
    status: 200,
    json: async () => ({
      ok: true,
      results: [{ leadId: '10', lead_id: '10', status: 'valid', valid: true }],
      meta: { operation: 'validate', mode: 'initial' },
    }),
  };
};

const result = await runStrictValidation(leads, 'validate', 'initial', '77');
if (result.length !== 1 || result[0].status !== 'valid') throw new Error('Resposta válida do Worker não foi aceita.');
if (captured.user_id !== '77') throw new Error('user_id autenticado não foi encaminhado ao Worker.');
if (captured.leads[0].normalized_phone !== '5511999999999') throw new Error('Telefone normalizado não foi encaminhado.');

// Cardinalidade divergente precisa bloquear o lote.
globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({ ok: true, results: [], meta: { operation: 'validate', mode: 'initial' } }),
});
let blocked = false;
try {
  await runStrictValidation(leads, 'validate', 'initial', '77');
} catch {
  blocked = true;
}
if (!blocked) throw new Error('Resposta sem correspondência exata deveria ser bloqueada.');

console.log('F05 Worker provider contract runtime tests: OK');
