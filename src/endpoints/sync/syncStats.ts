import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import { HandleArgs } from '../../types';
import { ContactSyncService } from '../../services/contactSyncService';

export class SyncStats extends OpenAPIRoute<HandleArgs> {
  schema = {
    tags: ['Sync'],
    summary: 'Get sync statistics',
    description: 'Returns statistics about synced contacts',
    responses: {
      '200': {
        description: 'Statistics retrieved successfully',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean(),
              data: z.object({
                total_contacts: z.number(),
                synced: z.number(),
                failed: z.number(),
                excluded_customers: z.number(),
                pending: z.number(),
              }),
            }),
          },
        },
      },
    },
  };

  async handle(c: HandleArgs[0]) {
    try {
      const env = c.env;

      const syncService = new ContactSyncService(
        env.GHL_API_KEY || '',
        env.CALLTOOLS_API_KEY || '',
        env.CALLTOOLS_BASE_URL,
        env.DB
      );

      const stats = await syncService.getSyncStats();

      return c.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      console.error('Error getting sync stats:', error);
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
