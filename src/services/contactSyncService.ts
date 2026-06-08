import { GoHighLevelClient, GHLContact } from '../clients/gohighlevel';
import { CallToolsClient, CallToolsContact } from '../clients/calltools';
import {
  InsuranceLineConfig,
  LineState,
  getInsuranceLines,
  matchInsuranceLine,
} from '../config/insuranceLines';

export interface SyncResult {
  total_processed: number;
  synced: number;
  updated: number;
  excluded_customers: number;
  failed: number;
  bucket_name: string;
  bucket_id: string | null;
  errors: Array<{
    contact_id: string;
    error: string;
  }>;
}

export interface SyncedContact {
  id?: number;
  ghl_contact_id: string;
  calltools_contact_id: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  sync_status: 'pending' | 'synced' | 'failed' | 'excluded';
  last_sync_at: string | null;
  error_message: string | null;
  is_customer: number;
  created_at?: string;
  updated_at?: string;
}

export class ContactSyncService {
  private ghlClient: GoHighLevelClient;
  private callToolsClient: CallToolsClient;
  private db: D1Database;
  private lines: InsuranceLineConfig[];

  constructor(
    ghlApiKey: string,
    callToolsApiKey: string,
    callToolsBaseUrl: string | undefined,
    db: D1Database,
    lines?: InsuranceLineConfig[]
  ) {
    this.ghlClient = new GoHighLevelClient(ghlApiKey);
    this.callToolsClient = new CallToolsClient(callToolsApiKey, callToolsBaseUrl);
    this.db = db;
    // Fall back to env-less defaults (ACA buckets preserved, Auto unconfigured)
    // so existing call sites keep working even if no lines are supplied.
    this.lines = lines && lines.length > 0 ? lines : getInsuranceLines({});
  }

  /**
   * Sync a single contact by ID from GoHighLevel
   * Used for webhook-triggered syncs
   */
  async syncSingleContact(ghlContactId: string, webhookContactData?: any): Promise<{
    success: boolean;
    contact_id: string;
    action: 'synced' | 'updated' | 'excluded' | 'failed';
    bucket_id: string | null;
    error?: string;
  }> {
    try {
      // Use webhook data if provided, otherwise fetch from GoHighLevel
      let ghlContact: any;
      if (webhookContactData) {
        console.log('Using contact data from webhook (avoiding API call)');
        // Transform webhook data to GHLContact format
        ghlContact = {
          id: webhookContactData.contact_id,
          firstName: webhookContactData.first_name,
          lastName: webhookContactData.last_name,
          name: webhookContactData.full_name,
          email: webhookContactData.email,
          phone: webhookContactData.phone,
          tags: webhookContactData.tags ? webhookContactData.tags.split(',') : [],
          contact_type: webhookContactData.contact_type,
        };
      } else {
        console.log('Fetching contact from GoHighLevel API');
        ghlContact = await this.ghlClient.getContact(ghlContactId);
      }

      // Check tags
      const tags: string[] = Array.isArray(ghlContact.tags)
        ? (ghlContact.tags as string[]).map((t) => String(t))
        : [];

      // Determine which insurance line + state (cold/hot/active) this maps to
      const match = matchInsuranceLine(tags, this.lines);

      // Generic customer exclusion (not tied to a specific line). A contact
      // flagged as a generic customer/won/purchased lead should never be dialed
      // as a cold/hot lead. Active matches are allowed through (they ARE
      // customers and route to the active bucket).
      const looksLikeCustomer = tags.some((raw) => {
        const tag = raw.toLowerCase();
        return (
          tag.includes('customer') ||
          tag.includes('client') ||
          tag.includes('won') ||
          tag.includes('purchased')
        );
      });

      if (match && match.state.name !== 'active' && looksLikeCustomer) {
        console.log(`Contact ${ghlContactId} excluded: matched ${match.state.name} but has customer/client tags`);
        await this.markAsCustomer(ghlContactId);
        return { success: true, contact_id: ghlContactId, action: 'excluded', bucket_id: null };
      }

      if (match) {
        console.log(
          `Contact ${ghlContactId} matched "${match.line.label}" ${match.state.name} state`
        );
        return await this.applyState(ghlContact, match.line, match.state);
      }

      if (looksLikeCustomer) {
        console.log(`Contact ${ghlContactId} excluded: contains customer/client tags`);
        await this.markAsCustomer(ghlContactId);
        return { success: true, contact_id: ghlContactId, action: 'excluded', bucket_id: null };
      }

      console.log(`Contact ${ghlContactId} excluded: does not match any insurance line state`);
      return {
        success: true,
        contact_id: ghlContactId,
        action: 'excluded',
        bucket_id: null,
        error: 'Contact does not match any insurance line state',
      };
    } catch (error) {
      console.error(`Error syncing single contact ${ghlContactId}:`, error);
      return {
        success: false,
        contact_id: ghlContactId,
        action: 'failed',
        bucket_id: null,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Apply an insurance-line state to a contact.
   *
   * The contact is created/updated in CallTools, added to the state's bucket
   * and tag, and removed from the buckets/tags listed on the state (e.g. a
   * cold-lead state removes the contact from the hot bucket). States flagged
   * `isCustomer` mark the contact as a customer in the DB and exclude it from
   * future cold syncs.
   */
  private async applyState(
    ghlContact: GHLContact,
    line: InsuranceLineConfig,
    state: LineState
  ): Promise<{
    success: boolean;
    contact_id: string;
    action: 'synced' | 'updated' | 'excluded' | 'failed';
    bucket_id: string | null;
    error?: string;
  }> {
    try {
      const stateLabel = `${line.label} ${state.name}`;
      console.log(`Processing ${stateLabel}: ${ghlContact.id}`);

      if (!state.bucketId) {
        console.error(`No bucket configured for "${stateLabel}", cannot sync ${ghlContact.id}`);
        return {
          success: false,
          contact_id: ghlContact.id,
          action: 'failed',
          bucket_id: null,
          error: `No bucket configured for "${stateLabel}". Set the corresponding bucket env var.`,
        };
      }

      // Don't re-add a known customer to a non-customer (cold/hot) bucket.
      if (!state.isCustomer) {
        const existingRecord = await this.getSyncedContact(ghlContact.id);
        if (existingRecord && existingRecord.is_customer === 1) {
          console.log(`Contact ${ghlContact.id} is a known customer, skipping ${state.name} sync`);
          return {
            success: true,
            contact_id: ghlContact.id,
            action: 'excluded',
            bucket_id: null,
          };
        }
      }

      // Check if contact has phone number
      const phone = ghlContact.phone || '';
      if (!phone) {
        console.warn(`Contact ${ghlContact.id} has no phone number, skipping`);
        await this.updateSyncRecord(ghlContact.id, {
          sync_status: 'failed',
          error_message: 'No phone number',
        });
        return {
          success: false,
          contact_id: ghlContact.id,
          action: 'failed',
          bucket_id: null,
          error: 'No phone number',
        };
      }

      // Prepare CallTools contact data
      const callToolsContact: CallToolsContact = {
        first_name: ghlContact.firstName || ghlContact.name || 'Unknown',
        last_name: ghlContact.lastName || '',
        mobile_phone_number: phone,
        personal_email_address: ghlContact.email || '',
        bucket_id: state.bucketId,
      };

      // Check if contact already exists in CallTools (search by phone)
      const existingCallToolsContact = await this.callToolsClient.getContactByExternalId(
        ghlContact.id,
        phone
      );

      const isUpdate = existingCallToolsContact !== null;

      let resolvedContactId: string;
      if (isUpdate) {
        console.log(`Updating existing contact ${ghlContact.id} as ${stateLabel}`);
        await this.callToolsClient.updateContact(existingCallToolsContact!.id, callToolsContact);
        resolvedContactId = existingCallToolsContact!.id;
      } else {
        console.log(`Creating new contact ${ghlContact.id} as ${stateLabel}`);
        const createdContact = await this.callToolsClient.createContact(callToolsContact);
        console.log(`Created contact with ID: ${createdContact.id}`);
        resolvedContactId = createdContact.id;
      }

      // Add to the state's bucket
      await this.callToolsClient.addContactToBucket(resolvedContactId, state.bucketId);
      console.log(`Added contact to ${stateLabel} bucket (${state.bucketId})`);

      // Add the state's tag
      await this.callToolsClient.addTagToContact(resolvedContactId, state.tag);
      console.log(`Added "${state.tag}" tag`);

      // Remove from the configured buckets
      for (const bucketId of state.removeBucketIds) {
        if (!bucketId || bucketId === state.bucketId) continue;
        try {
          await this.callToolsClient.removeContactFromBucket(resolvedContactId, bucketId);
          console.log(`Removed contact from bucket (${bucketId})`);
        } catch (error) {
          console.log(`Could not remove from bucket ${bucketId} (may not be in it):`, error);
        }
      }

      // Remove the configured tags
      for (const tag of state.removeTags) {
        if (!tag || tag === state.tag) continue;
        try {
          await this.callToolsClient.removeTagFromContact(resolvedContactId, tag);
          console.log(`Removed "${tag}" tag`);
        } catch (error) {
          console.log(`Could not remove "${tag}" tag (may not exist):`, error);
        }
      }

      // Update database
      await this.createOrUpdateSyncRecord({
        ghl_contact_id: ghlContact.id,
        calltools_contact_id: resolvedContactId,
        first_name: callToolsContact.first_name,
        last_name: callToolsContact.last_name || null,
        phone: callToolsContact.mobile_phone_number || null,
        email: callToolsContact.email || null,
        sync_status: 'synced',
        last_sync_at: new Date().toISOString(),
        error_message: null,
        is_customer: state.isCustomer ? 1 : 0,
      });

      if (state.isCustomer) {
        await this.markAsCustomer(ghlContact.id);
      }

      console.log(`Successfully ${isUpdate ? 'updated' : 'created'} contact ${ghlContact.id} as ${stateLabel}`);

      return {
        success: true,
        contact_id: ghlContact.id,
        action: isUpdate ? 'updated' : 'synced',
        bucket_id: state.bucketId,
      };
    } catch (error) {
      console.error(`Error applying state ${state.name} for ${ghlContact.id}:`, error);
      await this.updateSyncRecord(ghlContact.id, {
        sync_status: 'failed',
        error_message: error instanceof Error ? error.message : 'Unknown error',
      });
      return {
        success: false,
        contact_id: ghlContact.id,
        action: 'failed',
        bucket_id: null,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Main batch sync function - syncs cold contacts from GHL to CallTools across
   * every configured insurance line (ACA, Auto, ...).
   *
   * Each contact is routed to the correct line bucket/tag based on its tags.
   * Active clients are also handled so the nightly batch can correct any missed
   * webhooks.
   */
  async syncColdContacts(): Promise<SyncResult> {
    const result: SyncResult = {
      total_processed: 0,
      synced: 0,
      updated: 0,
      excluded_customers: 0,
      failed: 0,
      bucket_name: 'Multiple (per line)',
      bucket_id: null,
      errors: [],
    };

    try {
      console.log('Fetching contacts from GoHighLevel for batch sync...');
      const allContacts = await this.ghlClient.getAllContacts();
      console.log(`Fetched ${allContacts.length} contacts from GoHighLevel`);

      // Route each contact to the correct insurance line + state
      for (const ghlContact of allContacts) {
        const tags = (ghlContact.tags || []).map((t) => String(t));
        const match = matchInsuranceLine(tags, this.lines);

        if (!match) {
          continue; // Doesn't match any insurance line state
        }

        // Skip generic customers (won/purchased) that aren't an active match
        const looksLikeCustomer = tags.some((raw) => {
          const tag = raw.toLowerCase();
          return tag.includes('customer') || tag.includes('won') || tag.includes('purchased');
        });
        if (match.state.name !== 'active' && looksLikeCustomer) {
          result.excluded_customers++;
          await this.markAsCustomer(ghlContact.id);
          continue;
        }

        result.total_processed++;

        try {
          const stateResult = await this.applyState(ghlContact, match.line, match.state);
          if (stateResult.action === 'synced') {
            result.synced++;
          } else if (stateResult.action === 'updated') {
            result.updated++;
          } else if (stateResult.action === 'excluded') {
            result.excluded_customers++;
          } else if (stateResult.action === 'failed') {
            result.failed++;
            if (stateResult.error) {
              result.errors.push({ contact_id: ghlContact.id, error: stateResult.error });
            }
          }
        } catch (error) {
          result.failed++;
          result.errors.push({
            contact_id: ghlContact.id,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          console.error(`Failed to sync contact ${ghlContact.id}:`, error);
        }
      }

      console.log('Batch sync completed:', result);
      return result;
    } catch (error) {
      console.error('Error during sync:', error);
      throw error;
    }
  }

  /**
   * Get a synced contact record from the database
   */
  private async getSyncedContact(ghlContactId: string): Promise<SyncedContact | null> {
    const result = await this.db
      .prepare('SELECT * FROM synced_contacts WHERE ghl_contact_id = ?')
      .bind(ghlContactId)
      .first<SyncedContact>();
    
    return result || null;
  }

  /**
   * Create or update a sync record
   */
  private async createOrUpdateSyncRecord(data: Omit<SyncedContact, 'id' | 'created_at' | 'updated_at'>): Promise<void> {
    const existing = await this.getSyncedContact(data.ghl_contact_id);
    
    if (existing) {
      await this.db
        .prepare(`
          UPDATE synced_contacts 
          SET calltools_contact_id = ?,
              first_name = ?,
              last_name = ?,
              phone = ?,
              email = ?,
              sync_status = ?,
              last_sync_at = ?,
              error_message = ?,
              is_customer = ?
          WHERE ghl_contact_id = ?
        `)
        .bind(
          data.calltools_contact_id,
          data.first_name,
          data.last_name,
          data.phone,
          data.email,
          data.sync_status,
          data.last_sync_at,
          data.error_message,
          data.is_customer,
          data.ghl_contact_id
        )
        .run();
    } else {
      await this.db
        .prepare(`
          INSERT INTO synced_contacts (
            ghl_contact_id,
            calltools_contact_id,
            first_name,
            last_name,
            phone,
            email,
            sync_status,
            last_sync_at,
            error_message,
            is_customer
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
          data.ghl_contact_id,
          data.calltools_contact_id || null,
          data.first_name || null,
          data.last_name || null,
          data.phone || null,
          data.email || null,
          data.sync_status,
          data.last_sync_at || null,
          data.error_message || null,
          data.is_customer
        )
        .run();
    }
  }

  /**
   * Update specific fields of a sync record
   */
  private async updateSyncRecord(
    ghlContactId: string,
    updates: Partial<Pick<SyncedContact, 'calltools_contact_id' | 'sync_status' | 'last_sync_at' | 'error_message' | 'first_name' | 'last_name' | 'phone' | 'email'>>
  ): Promise<void> {
    const existing = await this.getSyncedContact(ghlContactId);
    
    if (!existing) {
      // Create a new record with the updates
      await this.createOrUpdateSyncRecord({
        ghl_contact_id: ghlContactId,
        calltools_contact_id: updates.calltools_contact_id || null,
        first_name: updates.first_name || null,
        last_name: updates.last_name || null,
        phone: updates.phone || null,
        email: updates.email || null,
        sync_status: updates.sync_status || 'pending',
        last_sync_at: updates.last_sync_at || null,
        error_message: updates.error_message || null,
        is_customer: 0,
      });
      return;
    }

    const fields: string[] = [];
    const values: any[] = [];

    if (updates.calltools_contact_id !== undefined) {
      fields.push('calltools_contact_id = ?');
      values.push(updates.calltools_contact_id);
    }
    if (updates.first_name !== undefined) {
      fields.push('first_name = ?');
      values.push(updates.first_name);
    }
    if (updates.last_name !== undefined) {
      fields.push('last_name = ?');
      values.push(updates.last_name);
    }
    if (updates.phone !== undefined) {
      fields.push('phone = ?');
      values.push(updates.phone);
    }
    if (updates.email !== undefined) {
      fields.push('email = ?');
      values.push(updates.email);
    }
    if (updates.sync_status !== undefined) {
      fields.push('sync_status = ?');
      values.push(updates.sync_status);
    }
    if (updates.last_sync_at !== undefined) {
      fields.push('last_sync_at = ?');
      values.push(updates.last_sync_at);
    }
    if (updates.error_message !== undefined) {
      fields.push('error_message = ?');
      values.push(updates.error_message);
    }

    if (fields.length === 0) return;

    values.push(ghlContactId);

    await this.db
      .prepare(`UPDATE synced_contacts SET ${fields.join(', ')} WHERE ghl_contact_id = ?`)
      .bind(...values)
      .run();
  }

  /**
   * Mark a contact as customer (will be excluded from future syncs)
   */
  async markAsCustomer(ghlContactId: string): Promise<void> {
    await this.updateSyncRecord(ghlContactId, {
      sync_status: 'excluded',
    });

    await this.db
      .prepare('UPDATE synced_contacts SET is_customer = 1 WHERE ghl_contact_id = ?')
      .bind(ghlContactId)
      .run();
  }

  /**
   * Get sync statistics
   */
  async getSyncStats(): Promise<{
    total_contacts: number;
    synced: number;
    failed: number;
    excluded_customers: number;
    pending: number;
  }> {
    const stats = await this.db
      .prepare(`
        SELECT 
          COUNT(*) as total_contacts,
          SUM(CASE WHEN sync_status = 'synced' THEN 1 ELSE 0 END) as synced,
          SUM(CASE WHEN sync_status = 'failed' THEN 1 ELSE 0 END) as failed,
          SUM(CASE WHEN is_customer = 1 THEN 1 ELSE 0 END) as excluded_customers,
          SUM(CASE WHEN sync_status = 'pending' THEN 1 ELSE 0 END) as pending
        FROM synced_contacts
      `)
      .first<any>();

    return {
      total_contacts: stats?.total_contacts || 0,
      synced: stats?.synced || 0,
      failed: stats?.failed || 0,
      excluded_customers: stats?.excluded_customers || 0,
      pending: stats?.pending || 0,
    };
  }
}
