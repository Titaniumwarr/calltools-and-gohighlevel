import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { GHLWebhook } from './ghlWebhook';

export const webhookRouter = fromHono(new Hono());

webhookRouter.post('/ghl', GHLWebhook);
