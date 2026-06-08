import { GoHighLevelClient, GHLContact } from '../clients/gohighlevel';
import { CallToolsClient, CallToolsContact } from '../clients/calltools';
import {
  InsuranceLineConfig,
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
        ? (ghlContact.tags as string[]).map((t) => String(t).toLowerCase())
        : [];

      // Determine which insurance line (and cold vs active) this contact maps to
      const match = matchInsuranceLine(tags, this.lines);

      // Active clients take priority across all lines (ACA, Auto, ...)
      if (match && match.type === 'active') {
        console.log(
          `Contact ${ghlContactId} matched active client for line "${match.line.label}"`
        );
        return await this.syncActiveClient(ghlContact, match.line);
      }

      // Hot leads (engaged but not yet sold) - promote to the line's hot bucket
      if (match && match.type === 'hot') {
        console.log(
          `Contact ${ghlContactId} matched hot lead for line "${match.line.label}"`
        );
        return await this.promoteContact(ghlContact, match.line, 'hot');
      }

      // Generic customer exclusion (not tied to a specific line). A contact
      // flagged as a generic customer/won/purchased lead should never be dialed
      // as a cold lead.
      const isCustomer = tags.some(tag =>
        tag.includes('customer') ||
        tag.includes('client') ||
        tag.includes('won') ||
        tag.includes('purchased')
      );

      if (isCustomer) {
        console.log(`Contact ${ghlContactId} excluded: contains customer/client tags`);
        await this.markAsCustomer(ghlContactId);
        return {
          success: true,
          contact_id: ghlContactId,
          action: 'excluded',
          bucket_id: null,
        };
      }

      if (!match || match.type !== 'cold') {
        console.log(`Contact ${ghlContactId} excluded: does not match any cold lead or active client line`);
        return {
          success: true,
          contact_id: ghlContactId,
          action: 'excluded',
          bucket_id: null,
          error: 'Contact does not match any cold lead or active client line',
        };
      }

      const line = match.line;

      if (!line.coldLeadsBucketId) {
        console.error(
          `Contact ${ghlContactId} matched line "${line.label}" cold lead, but no cold leads bucket is configured`
        );
        return {
          success: false,
          contact_id: ghlContactId,
          action: 'failed',
          bucket_id: null,
          error: `No cold leads bucket configured for line "${line.label}". Set the corresponding bucket env var.`,
        };
      }

      console.log(
        `Contact ${ghlContactId} is a "${line.label}" cold lead, syncing to CallTools bucket ${line.coldLeadsBucketId}`
      );

      // Sync the contact
      const result: SyncResult = {
        total_processed: 1,
        synced: 0,
        updated: 0,
        excluded_customers: 0,
        failed: 0,
        bucket_name: `${line.label} Cold Leads`,
        bucket_id: line.coldLeadsBucketId,
        errors: [],
      };

      await this.syncContact(ghlContact, result, line);

      const action = result.synced > 0 ? 'synced' : result.updated > 0 ? 'updated' : 'failed';

      return {
        success: result.failed === 0,
        contact_id: ghlContactId,
        action,
        bucket_id: line.coldLeadsBucketId,
        error: result.errors[0]?.error,
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
   * Convenience wrapper: promote a contact to the active-client tier.
   */
  private async syncActiveClient(
    ghlContact: GHLContact,
    line: InsuranceLineConfig
  ): Promise<{
    success: boolean;
    contact_id: string;
    action: 'synced' | 'updated' | 'excluded' | 'failed';
    bucket_id: string | null;
    error?: string;
  }> {
    return this.promoteContact(ghlContact, line, 'active');
  }

  /**
   * Promote a contact into a higher tier (hot lead or active client) for a line.
   *
   * The contact is created/updated in CallTools, added to the target tier's
   * bucket/tag, and removed from the buckets/tags of all lower tiers. Active
   * clients are additionally marked as customers in the database (and excluded
   * from future cold-lead syncs); hot leads are not.
   */
  private async promoteContact(
    ghlContact: GHLContact,
    line: InsuranceLineConfig,
    tier: 'hot' | 'active'
  ): Promise<{
    success: boolean;
    contact_id: string;
    action: 'synced' | 'updated' | 'excluded' | 'failed';
    bucket_id: string | null;
    error?: string;
  }> {
    try {
      const isActive = tier === 'active';
      const tierLabel = isActive ? 'active client' : 'hot lead';

      // Resolve the target bucket/tag and the lower tiers to clean up.
      const targetBucketId = isActive ? line.activeClientsBucketId : (line.hotLeadsBucketId || '');
      const targetTag = isActive ? line.activeClientTag : (line.hotLeadTag || '');

      // Lower-tier buckets/tags to remove the contact from on promotion.
      const removeBucketIds: string[] = [];
      const removeTags: string[] = [];
      if (line.coldLeadsBucketId) removeBucketIds.push(line.coldLeadsBucketId);
      if (line.coldLeadTag) removeTags.push(line.coldLeadTag);
      if (isActive) {
        if (line.hotLeadsBucketId) removeBucketIds.push(line.hotLeadsBucketId);
        if (line.hotLeadTag) removeTags.push(line.hotLeadTag);
      }

      console.log(`Processing ${tierLabel} for line "${line.label}": ${ghlContact.id}`);

      if (!targetBucketId || !targetTag) {
        console.error(
          `No ${tierLabel} bucket configured for line "${line.label}", cannot sync ${ghlContact.id}`
        );
        return {
          success: false,
          contact_id: ghlContact.id,
          action: 'failed',
          bucket_id: null,
          error: `No ${tierLabel} bucket configured for line "${line.label}". Set the corresponding bucket env var.`,
        };
      }

      // Check if contact has phone number
      const phone = ghlContact.phone || '';
      if (!phone) {
        console.warn(`Contact ${ghlContact.id} has no phone number, skipping`);
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
        bucket_id: targetBucketId,
      };

      // Check if contact already exists in CallTools (search by phone)
      const existingCallToolsContact = await this.callToolsClient.getContactByExternalId(
        ghlContact.id,
        phone
      );

      const contactId = existingCallToolsContact ? existingCallToolsContact.id : null;
      const isUpdate = contactId !== null;

      let resolvedContactId: string;
      if (isUpdate) {
        console.log(`Updating existing contact ${ghlContact.id} as ${tierLabel}`);
        await this.callToolsClient.updateContact(contactId!, callToolsContact);
        resolvedContactId = contactId!;
      } else {
        console.log(`Creating new contact ${ghlContact.id} as ${tierLabel}`);
        const createdContact = await this.callToolsClient.createContact(callToolsContact);
        console.log(`Created contact with ID: ${createdContact.id}`);
        resolvedContactId = createdContact.id;
      }

      // Add to the target tier bucket
      await this.callToolsClient.addContactToBucket(resolvedContactId, targetBucketId);
      console.log(`Added contact to ${tierLabel} bucket (${targetBucketId})`);

      // Add the target tier tag
      await this.callToolsClient.addTagToContact(resolvedContactId, targetTag);
      console.log(`Added "${targetTag}" tag`);

      // Remove from lower-tier buckets
      for (const bucketId of removeBucketIds) {
        try {
          await this.callToolsClient.removeContactFromBucket(resolvedContactId, bucketId);
          console.log(`Removed contact from lower-tier bucket (${bucketId})`);
        } catch (error) {
          console.log(`Could not remove from bucket ${bucketId} (may not be in it):`, error);
        }
      }

      // Remove lower-tier tags
      for (const tag of removeTags) {
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
        is_customer: isActive ? 1 : 0,
      });

      // Active clients are excluded from future cold syncs
      if (isActive) {
        await this.markAsCustomer(ghlContact.id);
      }

      console.log(`Successfully ${isUpdate ? 'updated' : 'created'} contact ${ghlContact.id} as ${tierLabel}`);

      return {
        success: true,
        contact_id: ghlContact.id,
        action: isUpdate ? 'updated' : 'synced',
        bucket_id: targetBucketId,
      };
    } catch (error) {
      console.error(`Error syncing ${tier} for ${ghlContact.id}:`, error);
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

      // Route each contact to the correct insurance line
      for (const ghlContact of allContacts) {
        const tags = (ghlContact.tags || []).map((t) => t.toLowerCase());
        const match = matchInsuranceLine(tags, this.lines);

        if (!match) {
          continue; // Not a cold lead or active client for any line
        }

        result.total_processed++;

        try {
          if (match.type === 'active' || match.type === 'hot') {
            const promoteResult =
              match.type === 'active'
                ? await this.syncActiveClient(ghlContact, match.line)
                : await this.promoteContact(ghlContact, match.line, 'hot');
            if (promoteResult.action === 'synced') {
              result.synced++;
            } else if (promoteResult.action === 'updated') {
              result.updated++;
            } else if (promoteResult.action === 'failed') {
              result.failed++;
              if (promoteResult.error) {
                result.errors.push({ contact_id: ghlContact.id, error: promoteResult.error });
              }
            }
            continue;
          }

          // Cold lead: skip generic customers (won/purchased) that aren't active
          const isCustomer = tags.some(
            (tag) =>
              tag.includes('customer') ||
              tag.includes('won') ||
              tag.includes('purchased')
          );
          if (isCustomer) {
            result.excluded_customers++;
            await this.markAsCustomer(ghlContact.id);
            continue;
          }

          if (!match.line.coldLeadsBucketId) {
            result.failed++;
            result.errors.push({
              contact_id: ghlContact.id,
              error: `No cold leads bucket configured for line "${match.line.label}"`,
            });
            continue;
          }

          await this.syncContact(ghlContact, result, match.line);
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
   * Sync a single cold-lead contact into the bucket/tag for its insurance line.
   */
  private async syncContact(ghlContact: GHLContact, result: SyncResult, line: InsuranceLineConfig): Promise<void> {
    const bucketId = line.coldLeadsBucketId;
    const coldLeadTag = line.coldLeadTag;

    // Check if contact is already tracked in our database
    const existingRecord = await this.getSyncedContact(ghlContact.id);

    // Skip if marked as customer
    if (existingRecord && existingRecord.is_customer === 1) {
      result.excluded_customers++;
      return;
    }

    // Prepare CallTools contact data
    const phone = ghlContact.phone || '';
    if (!phone) {
      console.warn(`Contact ${ghlContact.id} has no phone number, skipping`);
      await this.updateSyncRecord(ghlContact.id, {
        sync_status: 'failed',
        error_message: 'No phone number',
      });
      result.failed++;
      return;
    }

    const callToolsContact: CallToolsContact = {
      first_name: ghlContact.firstName || ghlContact.name || 'Unknown',
      last_name: ghlContact.lastName || '',
      mobile_phone_number: phone,
      personal_email_address: ghlContact.email || '',
      bucket_id: bucketId, // Assign to this line's Cold Leads bucket
      // Don't send tags in create payload - add them separately after creation
    };

    try {
      // Check if contact already exists in CallTools (search by phone)
      const existingCallToolsContact = await this.callToolsClient.getContactByExternalId(
        ghlContact.id,
        phone
      );

      if (existingCallToolsContact) {
        // Update existing contact
        await this.callToolsClient.updateContact(
          existingCallToolsContact.id,
          callToolsContact
        );
        
        // Add contact to Cold Leads bucket
        if (bucketId) {
          await this.callToolsClient.addContactToBucket(
            existingCallToolsContact.id,
            bucketId
          );
          console.log(`Added contact ${existingCallToolsContact.id} to bucket ${bucketId}`);
        }
        
        // Add cold lead tag for this line
        await this.callToolsClient.addTagToContact(
          existingCallToolsContact.id,
          coldLeadTag
        );
        
        await this.updateSyncRecord(ghlContact.id, {
          calltools_contact_id: existingCallToolsContact.id,
          first_name: callToolsContact.first_name,
          last_name: callToolsContact.last_name,
          phone: callToolsContact.mobile_phone_number,
          email: callToolsContact.email,
          sync_status: 'synced',
          last_sync_at: new Date().toISOString(),
          error_message: null,
        });
        
        result.updated++;
        console.log(`Updated contact ${ghlContact.id} in CallTools and added to ${line.label} Cold Leads bucket`);
      } else {
        // Create new contact
        const createdContact = await this.callToolsClient.createContact(callToolsContact);
        
        // Add contact to Cold Leads bucket
        if (bucketId) {
          await this.callToolsClient.addContactToBucket(
            createdContact.id,
            bucketId
          );
          console.log(`Added contact ${createdContact.id} to bucket ${bucketId}`);
        }
        
        // Add cold lead tag for this line
        await this.callToolsClient.addTagToContact(
          createdContact.id,
          coldLeadTag
        );
        
        await this.createOrUpdateSyncRecord({
          ghl_contact_id: ghlContact.id,
          calltools_contact_id: createdContact.id,
          first_name: callToolsContact.first_name,
          last_name: callToolsContact.last_name || null,
          phone: callToolsContact.mobile_phone_number || null,
          email: callToolsContact.email || null,
          sync_status: 'synced',
          last_sync_at: new Date().toISOString(),
          error_message: null,
          is_customer: 0,
        });
        
        result.synced++;
        console.log(`Created contact ${ghlContact.id} in CallTools and added to ${line.label} Cold Leads bucket`);
      }
    } catch (error) {
      await this.updateSyncRecord(ghlContact.id, {
        sync_status: 'failed',
        error_message: error instanceof Error ? error.message : 'Unknown error',
      });
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
