import type { Instrumentation } from 'next';
import { reportServerError } from './lib/server-errors';

export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  reportServerError(error, { route: context.routePath, method: request.method });
};
