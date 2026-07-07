import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import updateHandler from './api/update';
import validateHandler from './api/whatsapp/validate';
import revalidateHandler from './api/whatsapp/revalidate';
import dispatchHandler from './api/whatsapp/dispatch';

type LocalApiResponse = {
  status(code: number): LocalApiResponse;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
  end(): void;
};

type LocalApiHandler = (req: { method?: string; body?: unknown; headers?: Record<string, string | string[] | undefined> }, res: LocalApiResponse) => Promise<void>;

function readJsonBody(req: { on: (event: string, callback: (chunk?: string) => void) => void; setEncoding?: (encoding: string) => void }) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    let body = '';
    req.setEncoding?.('utf8');
    req.on('data', (chunk = '') => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('JSON inválido no corpo da requisição.'));
      }
    });
    req.on('error', () => reject(new Error('Erro ao ler corpo da requisição.')));
  });
}

function createLocalResponse(res: { statusCode: number; end: (body?: string) => void; setHeader: (name: string, value: string) => void }): LocalApiResponse {
  const apiRes: LocalApiResponse = {
    status(code: number) {
      res.statusCode = code;
      return apiRes;
    },
    json(body: unknown) {
      res.end(JSON.stringify(body));
    },
    setHeader(name: string, value: string) {
      res.setHeader(name, value);
    },
    end() {
      res.end();
    },
  };
  return apiRes;
}

function localApiPlugin(): Plugin {
  const register = (server: Parameters<NonNullable<Plugin['configureServer']>>[0], route: string, handler: LocalApiHandler) => {
    server.middlewares.use(route, async (req, res) => {
      try {
        const body = req.method === 'POST' ? await readJsonBody(req) : {};
        await handler(
          { method: req.method, body, headers: req.headers as Record<string, string | string[] | undefined> },
          createLocalResponse(res),
        );
      } catch (error) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Erro na API local.' }));
      }
    });
  };

  return {
    name: 'lead-certo-local-api',
    configureServer(server) {
      register(server, '/api/update', updateHandler as LocalApiHandler);
      register(server, '/api/whatsapp/validate', validateHandler as LocalApiHandler);
      register(server, '/api/whatsapp/revalidate', revalidateHandler as LocalApiHandler);
      register(server, '/api/whatsapp/dispatch', dispatchHandler as LocalApiHandler);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  for (const [key, value] of Object.entries(env)) {
    process.env[key] ??= value;
  }

  return {
    plugins: [react(), localApiPlugin()],
    server: {
      port: 5173,
    },
  };
});
