import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { SyncTrigger } from './syncTrigger';
import { SyncStats } from './syncStats';
import { MarkCustomer } from './markCustomer';

export const syncRouter = fromHono(new Hono());

syncRouter.post('/trigger', SyncTrigger);
syncRouter.get('/stats', SyncStats);
syncRouter.post('/mark-customer/:ghl_contact_id', MarkCustomer);
