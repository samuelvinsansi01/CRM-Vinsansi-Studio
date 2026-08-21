export type RoutedRequest = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[] | undefined>;
};

export type RoutedResponse = {
  status(code: number): RoutedResponse;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
  end(): void;
};

export type RouteHandler = (req: any, res: any) => unknown | Promise<unknown>;

export function routedPath(req: RoutedRequest) {
  const value = req.query?.route;
  return String(Array.isArray(value) ? value[0] : value ?? '').trim().replace(/^\/+|\/+$/g, '');
}

export async function dispatchRoute(
  req: RoutedRequest,
  res: RoutedResponse,
  handlers: Readonly<Record<string, RouteHandler>>,
  notFoundCode: string,
) {
  const selected = handlers[routedPath(req)];
  if (!selected) return res.status(404).json({ ok: false, error: notFoundCode });
  return selected(req, res);
}
