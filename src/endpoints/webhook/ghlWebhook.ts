import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import { HandleArgs } from '../../types';
import { ContactSyncService } from '../../services/contactSyncService';
import { WebhookVerificationService } from '../../services/webhookVerification';

// GoHighLevel webhook payload schema - flexible to handle different formats
const GHLWebhookSchema = z.object({
  type: z.string().optional(),
  location_id: z.string().optional(),
  locationId: z.string().optional(),
  id: z.string().optional(),
  contactId: z.string().optional(),
  contact_id: z.string().optional(),
  contact: z.any().optional(),
  timestamp: z.number().optional(),
}).passthrough(); // Allow any other fields

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
        console.error('Failed to parse JSON:', error);
        return c.json(
          {
            success: false,
            message: 'Invalid JSON payload',
          },
          400
        );
      }

      // Log the full payload for debugging
      console.log('=== Full GHL Webhook Payload ===');
      console.log(JSON.stringify(webhookData, null, 2));

      // Validate webhook data
      const validation = GHLWebhookSchema.safeParse(webhookData);
      if (!validation.success) {
        console.error('Schema validation failed:', validation.error);
        // Don't fail - just log and continue
      }

      const webhook = validation.success ? validation.data : webhookData;

      // Extract contact ID from various possible locations
      const contactId = 
        webhook.id || 
        webhook.contactId || 
        webhook.contact_id ||
        webhook.contact?.id ||
        webhookData.id ||
        webhookData.contactId ||
        webhookData.contact_id ||
        webhookData.contact?.id;

      if (!contactId) {
        console.error('No contact ID found in webhook payload');
        console.log('Available fields:', Object.keys(webhookData));
        return c.json(
          {
            success: false,
            message: 'No contact ID found in webhook payload',
            debug: {
              received_fields: Object.keys(webhookData),
              hint: 'Expected id, contactId, contact_id, or contact.id',
            },
          },
          400
        );
      }

      console.log(`Processing webhook for contact ${contactId}`);

      // Initialize sync service
      const syncService = new ContactSyncService(
        env.GHL_API_KEY,
        env.CALLTOOLS_API_KEY,
        env.CALLTOOLS_BASE_URL,
        env.DB
      );

      // Sync the specific contact, passing webhook data to avoid API call
      const result = await syncService.syncSingleContact(contactId, webhookData);

      console.log(`Sync result for ${contactId}: ${result.action} (success: ${result.success})`);

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
