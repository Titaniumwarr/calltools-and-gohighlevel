import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { GHLWebhook } from './ghlWebhook';
import { GHLWorkflow } from './ghlWorkflow';

export const webhookRouter = fromHono(new Hono());

// Official GHL webhook (requires signature)
webhookRouter.post('/ghl', GHLWebhook);

// GHL workflow endpoint (no signature required)
webhookRouter.post('/ghl-workflow', GHLWorkflow);
