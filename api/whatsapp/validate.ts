import { handleValidationRequest, type ApiRequest, type ApiResponse } from './validation.handler.js';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  await handleValidationRequest(req, res, 'initial');
}
