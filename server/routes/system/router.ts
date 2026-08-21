import { dispatchRoute, type RoutedRequest, type RoutedResponse } from '../dispatch.js';
import sendChatMessage from './chat/send.js';
import evolutionInstances from './desktop/evolution-instances.js';
import workerProvision from './desktop/worker-provision.js';

const handlers = {
  'chat/send': sendChatMessage,
  'desktop/evolution-instances': evolutionInstances,
  'desktop/worker-provision': workerProvision,
};

export default function systemRouter(req: RoutedRequest, res: RoutedResponse) {
  return dispatchRoute(req, res, handlers, 'system_route_not_found');
}
