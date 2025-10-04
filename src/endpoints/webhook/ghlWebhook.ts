import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import { HandleArgs } from '../../types';
import { ContactSyncService } from '../../services/contactSyncService';
import { WebhookVerificationService } from '../../services/webhookVerification';

// GoHighLevel webhook payload schema
const GHLWebhookSchema = z.object({
  type: z.string(), // e.g., "ContactUpdate", "ContactCreate"
  location_id: z.string(),
  id: z.string(), // Contact ID
  contact: z.object({
    id: z.string(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    name: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    tags: z.array(z.string()).optional(),
  }).optional(),
  timestamp: z.number().optional(),
});

export class GHLWebhook extends OpenAPIRoute<HandleArgs> {
  schema = {
    tags: ['Webhook'],
    summary: 'GoHighLevel webhook endpoint',
    description: 'Receives webhooks from GoHighLevel for real-time contact syncing',
    request: {
      body: {
        content: {
          'application/json': {
            schema: GHLWebhookSchema,
          },
        },
      },
      headers: z.object({
        'x-ghl-signature': z.string().optional(),
      }),
    },
    responses: {
      '200': {
        description: 'Webhook processed successfully',
        content: {
          'application/json': {
            schema: z.object({
              success: z.boolean(),
              message: z.string(),
              data: z.object({
                contact_id: z.string(),
                action: z.enum(['synced', 'updated', 'excluded', 'failed']),
                bucket_id: z.string().nullable(),
              }).optional(),
            }),
          },
        },
      },
      '401': {
        description: 'Webhook verification failed',
      },
      '400': {
        description: 'Invalid webhook payload',
      },
    },
  };

  async handle(c: HandleArgs[0]) {
    try {
      const env = c.env;

      // Get the raw body
      const rawBody = await c.req.text();
      const signature = c.req.header('x-ghl-signature') || null;

      // Verify webhook signature if secret is configured
      if (env.GHL_WEBHOOK_SECRET) {
        if (!signature) {
          console.warn('GHL_WEBHOOK_SECRET is set but no signature received. Proceeding anyway...');
        } else {
          const verificationService = new WebhookVerificationService(
            env.GHL_WEBHOOK_SECRET
          );

          const isValid = await verificationService.verifySignature(
            rawBody,
            signature
          );

          if (!isValid) {
            console.error('Webhook signature verification failed');
            return c.json(
              {
                success: false,
                message: 'Invalid webhook signature',
              },
              401
            );
          }

          console.log('Webhook signature verified successfully');
        }
      } else {
        console.log('GHL_WEBHOOK_SECRET not configured, skipping signature verification');
      }

      // Parse the webhook payload
      let webhookData;
      try {
        webhookData = JSON.parse(rawBody);
      } catch (error) {
        return c.json(
          {
            success: false,
            message: 'Invalid JSON payload',
          },
          400
        );
      }

      // Validate webhook data
      const validation = GHLWebhookSchema.safeParse(webhookData);
      if (!validation.success) {
        console.error('Invalid webhook payload:', validation.error);
        return c.json(
          {
            success: false,
            message: 'Invalid webhook payload format',
          },
          400
        );
      }

      const webhook = validation.data;

      // Verify timestamp if present
      if (webhook.timestamp && env.GHL_WEBHOOK_SECRET) {
        const verificationService = new WebhookVerificationService(
          env.GHL_WEBHOOK_SECRET
        );
        
        if (!verificationService.verifyTimestamp(webhook.timestamp)) {
          return c.json(
            {
              success: false,
              message: 'Webhook timestamp is invalid or too old',
            },
            401
          );
        }
      }

      // Check if this is a relevant event type
      const relevantTypes = ['ContactUpdate', 'ContactCreate', 'ContactTagUpdate'];
      if (!relevantTypes.includes(webhook.type)) {
        console.log(`Ignoring webhook type: ${webhook.type}`);
        return c.json({
          success: true,
          message: `Webhook type ${webhook.type} ignored`,
        });
      }

      console.log(`Processing ${webhook.type} webhook for contact ${webhook.id}`);

      // Initialize sync service
      const syncService = new ContactSyncService(
        env.GHL_API_KEY,
        env.CALLTOOLS_API_KEY,
        env.CALLTOOLS_BASE_URL,
        env.DB
      );

      // Sync the specific contact
      const result = await syncService.syncSingleContact(webhook.id);

      return c.json({
        success: result.success,
        message: result.success
          ? `Contact ${result.action} successfully`
          : `Failed to sync contact: ${result.error}`,
        data: {
          contact_id: result.contact_id,
          action: result.action,
          bucket_id: result.bucket_id,
        },
      });
    } catch (error) {
      console.error('Webhook processing error:', error);
      return c.json(
        {
          success: false,
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        500
      );
    }
  }
}
