import { GoHighLevelClient, GHLContact } from '../clients/gohighlevel';
import { CallToolsClient, CallToolsContact } from '../clients/calltools';

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

  constructor(
    ghlApiKey: string,
    callToolsApiKey: string,
    callToolsBaseUrl: string | undefined,
    db: D1Database
  ) {
    this.ghlClient = new GoHighLevelClient(ghlApiKey);
    this.callToolsClient = new CallToolsClient(callToolsApiKey, callToolsBaseUrl);
    this.db = db;
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
      // Use the Cold Leads bucket ID
      const bucketId = '11237';
      console.log(`Using Cold Leads bucket ID: ${bucketId}`);

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

      // Check if contact is a customer
      const tags = Array.isArray(ghlContact.tags) 
        ? (ghlContact.tags || []).map((t: string) => t.toLowerCase())
        : [];
      const isCustomer = tags.some(tag => 
        tag.includes('customer') || 
        tag.includes('client') ||
        tag.includes('won') ||
        tag.includes('purchased')
      );

      if (isCustomer) {
        // Mark as customer and exclude
        console.log(`Contact ${ghlContactId} excluded: contains customer/client tags`);
        await this.markAsCustomer(ghlContactId);
        return {
          success: true,
          contact_id: ghlContactId,
          action: 'excluded',
          bucket_id: null,
        };
      }

      // Check if contact has "cold lead" tag
      const isCold = tags.some(tag => 
        tag === 'cold lead' ||
        tag.includes('cold') ||
        tag.includes('new lead') ||
        tag.includes('prospect')
      );

      if (!isCold) {
        console.log(`Contact ${ghlContactId} excluded: does not have cold lead tag`);
        return {
          success: true,
          contact_id: ghlContactId,
          action: 'excluded',
          bucket_id: null,
          error: 'Contact does not have cold lead tag',
        };
      }

      console.log(`Contact ${ghlContactId} is a cold lead, proceeding to sync to CallTools`);

      // Sync the contact
      const result: SyncResult = {
        total_processed: 1,
        synced: 0,
        updated: 0,
        excluded_customers: 0,
        failed: 0,
        bucket_name: 'Cold Leads',
        bucket_id: bucketId,
        errors: [],
      };

      await this.syncContact(ghlContact, result, bucketId);

      const action = result.synced > 0 ? 'synced' : result.updated > 0 ? 'updated' : 'failed';

      return {
        success: result.failed === 0,
        contact_id: ghlContactId,
        action,
        bucket_id: bucketId,
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
   * Main sync function - syncs cold contacts from GHL to CallTools
   */
  async syncColdContacts(): Promise<SyncResult> {
    const bucketName = 'Cold Leads';
    const result: SyncResult = {
      total_processed: 0,
      synced: 0,
      updated: 0,
      excluded_customers: 0,
      failed: 0,
      bucket_name: bucketName,
      bucket_id: null,
      errors: [],
    };

    try {
      // Use the Cold Leads bucket ID
      const bucketId = '11237';
      result.bucket_id = bucketId;
      console.log(`Using Cold Leads bucket ID: ${bucketId}`);

      console.log('Fetching cold contacts from GoHighLevel...');
      const coldContacts = await this.ghlClient.getColdContactsExcludingCustomers();
      result.total_processed = coldContacts.length;
      
      console.log(`Found ${coldContacts.length} cold contacts to process`);

      // Process each contact
      for (const ghlContact of coldContacts) {
        try {
          await this.syncContact(ghlContact, result, bucketId || '');
        } catch (error) {
          result.failed++;
          result.errors.push({
            contact_id: ghlContact.id,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          console.error(`Failed to sync contact ${ghlContact.id}:`, error);
        }
      }

      console.log('Sync completed:', result);
      return result;
    } catch (error) {
      console.error('Error during sync:', error);
      throw error;
    }
  }

  /**
   * Sync a single contact
   */
  private async syncContact(ghlContact: GHLContact, result: SyncResult, bucketId: string): Promise<void> {
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
      phone_number: phone,
      email: ghlContact.email || '',
      external_id: ghlContact.id,
      bucket_id: bucketId, // Assign to Cold Leads bucket
      // Don't send tags in create payload - add them separately after creation
    };

    try {
      // Check if contact already exists in CallTools
      const existingCallToolsContact = await this.callToolsClient.getContactByExternalId(
        ghlContact.id
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
        
        // Add ACA Cold lead tag
        await this.callToolsClient.addTagToContact(
          existingCallToolsContact.id,
          'ACA Cold lead'
        );
        
        await this.updateSyncRecord(ghlContact.id, {
          calltools_contact_id: existingCallToolsContact.id,
          first_name: callToolsContact.first_name,
          last_name: callToolsContact.last_name,
          phone: callToolsContact.phone_number,
          email: callToolsContact.email,
          sync_status: 'synced',
          last_sync_at: new Date().toISOString(),
          error_message: null,
        });
        
        result.updated++;
        console.log(`Updated contact ${ghlContact.id} in CallTools and added to Cold Leads bucket`);
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
        
        // Add ACA Cold lead tag
        await this.callToolsClient.addTagToContact(
          createdContact.id,
          'ACA Cold lead'
        );
        
        await this.createOrUpdateSyncRecord({
          ghl_contact_id: ghlContact.id,
          calltools_contact_id: createdContact.id,
          first_name: callToolsContact.first_name,
          last_name: callToolsContact.last_name || null,
          phone: callToolsContact.phone_number,
          email: callToolsContact.email || null,
          sync_status: 'synced',
          last_sync_at: new Date().toISOString(),
          error_message: null,
          is_customer: 0,
        });
        
        result.synced++;
        console.log(`Created contact ${ghlContact.id} in CallTools and added to Cold Leads bucket`);
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
