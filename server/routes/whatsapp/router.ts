import { dispatchRoute, type RoutedRequest, type RoutedResponse } from '../dispatch.js';
import batch from './batch.js';
import dispatch from './dispatch.js';
import revalidate from './revalidate.js';
import validate from './validate.js';

const handlers = { batch, dispatch, revalidate, validate };

export default function whatsappRouter(req: RoutedRequest, res: RoutedResponse) {
  return dispatchRoute(req, res, handlers, 'whatsapp_route_not_found');
}
