import { OpenAPIRoute, Str } from 'chanfana';
import { z } from 'zod';
import { HandleArgs } from '../../types';
import { ContactSyncService } from '../../services/contactSyncService';

export class SyncTrigger extends OpenAPIRoute<HandleArgs> {
  schema = {
    tags: ['Sync'],
    summary: 'Trigger contact sync from GoHighLevel to CallTools',
    description: 'Syncs cold contacts from GoHighLevel to CallTools, excluding customers',
    responses: {
      '200': {
        description: 'Sync completed successfully',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean(),
              data: z.object({
                total_processed: z.number(),
                synced: z.number(),
                updated: z.number(),
                excluded_customers: z.number(),
                failed: z.number(),
                errors: z.array(z.object({
                  contact_id: z.string(),
                  error: z.string(),
                })),
              }),
            }),
          },
        },
      },
      '500': {
        description: 'Sync failed',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean(),
              error: z.string(),
            }),
          },
        },
      },
    },
  };

  async handle(c: HandleArgs[0]) {
    try {
      const env = c.env;
      
      // Validate that API keys are configured
      if (!env.GHL_API_KEY) {
        return c.json(
          { success: false, error: 'GoHighLevel API key not configured' },
          500
        );
      }
      
      if (!env.CALLTOOLS_API_KEY) {
        return c.json(
          { success: false, error: 'CallTools API key not configured' },
          500
        );
      }

      // Initialize sync service
      const syncService = new ContactSyncService(
        env.GHL_API_KEY,
        env.CALLTOOLS_API_KEY,
        env.CALLTOOLS_BASE_URL,
        env.DB
      );

      // Run sync
      const result = await syncService.syncColdContacts();

      return c.json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error('Sync error:', error);
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        500
      );
    }
  }
}
