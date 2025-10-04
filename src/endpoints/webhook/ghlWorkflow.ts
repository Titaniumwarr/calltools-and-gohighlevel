import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import { HandleArgs } from '../../types';
import { ContactSyncService } from '../../services/contactSyncService';

// GHL Workflow payload schema - flexible to handle different formats
const GHLWorkflowSchema = z.object({
  // Common fields that might come from workflows
  contact_id: z.string().optional(),
  contactId: z.string().optional(),
  id: z.string().optional(),
  
  // Contact details
  first_name: z.string().optional(),
  firstName: z.string().optional(),
  last_name: z.string().optional(),
  lastName: z.string().optional(),
  name: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  tags: z.union([z.array(z.string()), z.string()]).optional(),
  
  // Allow any other fields
}).passthrough();

export class GHLWorkflow extends OpenAPIRoute<HandleArgs> {
  schema = {
    tags: ['Webhook'],
    summary: 'GoHighLevel workflow endpoint (no signature required)',
    description: 'Receives HTTP POST from GoHighLevel workflows for contact syncing. This endpoint does not require webhook signature verification.',
    request: {
      body: {
        content: {
          'application/json': {
            schema: GHLWorkflowSchema,
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Workflow processed successfully',
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
    },
  };

  async handle(c: HandleArgs[0]) {
    try {
      const env = c.env;

      // Get the request body
      const rawBody = await c.req.text();
      
      console.log('=== GHL Workflow Received ===');
      console.log('Raw body:', rawBody);
      
      // Parse the workflow payload
      let workflowData;
      try {
        workflowData = JSON.parse(rawBody);
      } catch (error) {
        console.error('Failed to parse JSON:', error);
        return c.json(
          {
            success: false,
            message: 'Invalid JSON payload',
            debug: {
              received: rawBody,
              error: error instanceof Error ? error.message : 'Unknown error',
            },
          },
          400
        );
      }

      console.log('Parsed workflow data:', JSON.stringify(workflowData, null, 2));

      // Extract contact ID (try different field names)
      const contactId = 
        workflowData.contact_id || 
        workflowData.contactId || 
        workflowData.id ||
        workflowData.contact?.id;

      if (!contactId) {
        console.error('No contact ID found in workflow data');
        return c.json(
          {
            success: false,
            message: 'No contact ID found in workflow data',
            debug: {
              received_fields: Object.keys(workflowData),
              hint: 'Make sure to include contact_id, contactId, or id in the workflow POST',
            },
          },
          400
        );
      }

      console.log(`Processing workflow for contact: ${contactId}`);

      // Check API keys are configured
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

      // Sync the specific contact
      console.log(`Syncing contact ${contactId} to CallTools...`);
      const result = await syncService.syncSingleContact(contactId);

      console.log('Sync result:', result);

      return c.json({
        success: result.success,
        message: result.success
          ? `Contact ${result.action} successfully in CallTools`
          : `Failed to sync contact: ${result.error}`,
        data: {
          contact_id: result.contact_id,
          action: result.action,
          bucket_id: result.bucket_id,
        },
      });
    } catch (error) {
      console.error('Workflow processing error:', error);
      return c.json(
        {
          success: false,
          message: error instanceof Error ? error.message : 'Unknown error',
          error_details: error instanceof Error ? error.stack : undefined,
        },
        500
      );
    }
  }
}