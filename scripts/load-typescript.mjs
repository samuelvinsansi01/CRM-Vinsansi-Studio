import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function loadTypeScript() {
  try {
    const local = await import('typescript');
    return local.default ?? local;
  } catch (localError) {
    try {
      const globalRoot = execFileSync('npm', ['root', '--global'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      const moduleUrl = pathToFileURL(path.join(globalRoot, 'typescript', 'lib', 'typescript.js')).href;
      const globalModule = await import(moduleUrl);
      return globalModule.default ?? globalModule;
    } catch {
      throw new Error(
        'TypeScript não foi encontrado. Execute "npm ci" antes de rodar a suíte de verificação.',
        { cause: localError },
      );
    }
  }
}
