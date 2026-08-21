import { dispatchRoute, type RoutedRequest, type RoutedResponse } from '../dispatch.js';
import extension from './extension.js';
import pair from './pair.js';

const handlers = { extension, pair };

export default function mapsRouter(req: RoutedRequest, res: RoutedResponse) {
  return dispatchRoute(req, res, handlers, 'maps_route_not_found');
}
