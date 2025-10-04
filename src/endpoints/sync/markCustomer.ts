import { OpenAPIRoute, Str } from 'chanfana';
import { z } from 'zod';
import { HandleArgs } from '../../types';
import { ContactSyncService } from '../../services/contactSyncService';

export class MarkCustomer extends OpenAPIRoute<HandleArgs> {
  schema = {
    tags: ['Sync'],
    summary: 'Mark a contact as customer',
    description: 'Marks a contact as a customer to exclude them from future syncs',
    request: {
      params: z.object({
        ghl_contact_id: Str({ description: 'GoHighLevel contact ID' }),
      }),
    },
    responses: {
      '200': {
        description: 'Contact marked as customer successfully',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean(),
              message: z.string(),
            }),
          },
        },
      },
    },
  };

  async handle(c: HandleArgs[0]) {
    try {
      const data = await this.getValidatedData<typeof this.schema>();
      const env = c.env;

      const syncService = new ContactSyncService(
        env.GHL_API_KEY || '',
        env.CALLTOOLS_API_KEY || '',
        env.CALLTOOLS_BASE_URL,
        env.DB
      );

      await syncService.markAsCustomer(data.params.ghl_contact_id);

      return c.json({
        success: true,
        message: 'Contact marked as customer and excluded from future syncs',
      });
    } catch (error) {
      console.error('Error marking contact as customer:', error);
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
