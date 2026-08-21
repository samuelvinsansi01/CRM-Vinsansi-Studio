import { dispatchRoute, type RoutedRequest, type RoutedResponse } from '../dispatch.js';
import invitations from './invitations.js';

const handlers = { invitations };

export default function organizationRouter(req: RoutedRequest, res: RoutedResponse) {
  return dispatchRoute(req, res, handlers, 'organization_route_not_found');
}
