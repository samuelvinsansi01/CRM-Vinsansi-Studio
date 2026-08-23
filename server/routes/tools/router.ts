import { dispatchRoute, type RoutedRequest, type RoutedResponse } from '../dispatch.js';
import config from './executor/config.js';
import context from './executor/context.js';
import heartbeat from './executor/heartbeat.js';
import logout from './executor/logout.js';
import pairExchange from './executor/pair-exchange.js';
import pairStart from './executor/pair-start.js';
import runtime from './executor/runtime.js';
import switchOrganization from './executor/switch.js';
import browserPair from './browser-pair.js';

const handlers = {
  'browser-pair': browserPair,
  'executor/config': config,
  'executor/context': context,
  'executor/heartbeat': heartbeat,
  'executor/logout': logout,
  'executor/pair-exchange': pairExchange,
  'executor/pair-start': pairStart,
  'executor/runtime': runtime,
  'executor/switch': switchOrganization,
};

export default function toolsRouter(req: RoutedRequest, res: RoutedResponse) {
  return dispatchRoute(req, res, handlers, 'tools_route_not_found');
}
