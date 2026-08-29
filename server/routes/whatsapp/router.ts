import { dispatchRoute, type RoutedRequest, type RoutedResponse } from '../dispatch.js';
import batch from './batch.js';
import dispatch from './dispatch.js';
import validate from './validate.js';
import conversations from './conversations.js';
import conversationMessages from './conversation-messages.js';
import conversationAction from './conversation-action.js';
import conversationMembers from './conversation-members.js';
import conversationPresence from './conversation-presence.js';
import conversationChannel from './conversation-channel.js';
import manualMessage from './manual-message.js';
import conversationMedia from './conversation-media.js';
import queueOperations from './queue-operations.js';

const handlers = {
  batch, dispatch, validate,
  conversations,
  'conversation-messages': conversationMessages,
  'conversation-action': conversationAction,
  'conversation-members': conversationMembers,
  'conversation-presence': conversationPresence,
  'conversation-channel': conversationChannel,
  'manual-message': manualMessage,
  'conversation-media': conversationMedia,
  'queue-operations': queueOperations,
};

export default function whatsappRouter(req: RoutedRequest, res: RoutedResponse) {
  return dispatchRoute(req, res, handlers, 'whatsapp_route_not_found');
}
