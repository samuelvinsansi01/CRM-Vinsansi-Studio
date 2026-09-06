import { dispatchRoute, type RoutedRequest, type RoutedResponse } from '../dispatch.js';
import sendChatMessage from './chat/send.js';
import evolutionInstances from './desktop/evolution-instances.js';
import workerProvision from './desktop/worker-provision.js';
import schemaHealth from './schema-health.js';
import publicConfig from './public-config.js';

const handlers = {
  'chat/send': sendChatMessage,
  'desktop/evolution-instances': evolutionInstances,
  'desktop/worker-provision': workerProvision,
  'schema-health': schemaHealth,
  'public-config': publicConfig,
};

export default function systemRouter(req: RoutedRequest, res: RoutedResponse) {
  return dispatchRoute(req, res, handlers, 'system_route_not_found');
}
