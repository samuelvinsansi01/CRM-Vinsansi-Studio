import { handleValidationRequest, type ApiResponse } from './validation.handler.js';

type ApiRequest = {
  method?: string;
  body?: unknown;
};

export default async function handler(req: ApiRequest, res: ApiResponse) {
  await handleValidationRequest(req, res, 'revalidation');
}
