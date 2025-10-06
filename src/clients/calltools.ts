/**
 * CallTools API Client
 * For managing contacts in the CallTools dialer system
 */

export interface CallToolsContact {
  first_name: string;
  last_name?: string;
  phone_number: string;
  email?: string;
  external_id?: string; // GoHighLevel contact ID
  bucket_id?: string; // Bucket/List ID to add contact to
  custom_fields?: Record<string, any>;
}

export interface CallToolsContactResponse {
  id: string;
  first_name: string;
  last_name?: string;
  phone_number: string;
  email?: string;
  external_id?: string;
  bucket_id?: string;
  created_at?: string;
  updated_at?: string;
}

export interface CallToolsListResponse {
  contacts: CallToolsContactResponse[];
  total?: number;
  page?: number;
  per_page?: number;
}

export interface CallToolsBucket {
  id: string;
  name: string;
  description?: string;
  contact_count?: number;
  created_at?: string;
  updated_at?: string;
}

export interface CallToolsBucketsResponse {
  buckets: CallToolsBucket[];
  total?: number;
}

export class CallToolsClient {
  private apiKey: string;
  private baseUrl: string = 'https://api.calltools.com/v1';

  constructor(apiKey: string, baseUrl?: string) {
    this.apiKey = apiKey;
    if (baseUrl) {
      this.baseUrl = baseUrl;
    }
  }

  /**
   * Create a new contact in CallTools
   */
  async createContact(contact: CallToolsContact): Promise<CallToolsContactResponse> {
    const url = `${this.baseUrl}/api/contacts/`;
    console.log(`Creating contact at: ${url}`);
    console.log(`Contact data:`, JSON.stringify(contact));
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(contact),
    });

    console.log(`Response status: ${response.status}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`CallTools API error: ${response.status} - ${errorText}`);
      throw new Error(
        `CallTools API error: ${response.status} - ${errorText}`
      );
    }

    const result = await response.json();
    console.log(`Contact created successfully:`, JSON.stringify(result));
    return result;
  }

  /**
   * Update an existing contact in CallTools
   */
  async updateContact(
    contactId: string,
    contact: Partial<CallToolsContact>
  ): Promise<CallToolsContactResponse> {
    const response = await fetch(`${this.baseUrl}/api/contacts/${contactId}/`, {
      method: 'PUT',
      headers: {
        'Authorization': `Token ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(contact),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `CallTools API error: ${response.status} - ${errorText}`
      );
    }

    return await response.json();
  }

  /**
   * Get a contact by external ID (GoHighLevel ID)
   */
  async getContactByExternalId(externalId: string): Promise<CallToolsContactResponse | null> {
    try {
      const response = await fetch(
        `${this.baseUrl}/api/contacts/?external_id=${encodeURIComponent(externalId)}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Token ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        const errorText = await response.text();
        throw new Error(
          `CallTools API error: ${response.status} - ${errorText}`
        );
      }

      const data: CallToolsListResponse = await response.json();
      return data.contacts && data.contacts.length > 0 ? data.contacts[0] : null;
    } catch (error) {
      console.error('Error fetching contact by external ID:', error);
      return null;
    }
  }

  /**
   * Delete a contact from CallTools
   */
  async deleteContact(contactId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/contacts/${contactId}/`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Token ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `CallTools API error: ${response.status} - ${errorText}`
      );
    }
  }

  /**
   * Bulk create contacts
   */
  async bulkCreateContacts(contacts: CallToolsContact[]): Promise<{
    success: number;
    failed: number;
    errors: Array<{ contact: CallToolsContact; error: string }>;
  }> {
    const results = {
      success: 0,
      failed: 0,
      errors: [] as Array<{ contact: CallToolsContact; error: string }>,
    };

    // Process in batches to avoid rate limits
    const batchSize = 10;
    for (let i = 0; i < contacts.length; i += batchSize) {
      const batch = contacts.slice(i, i + batchSize);
      
      await Promise.all(
        batch.map(async (contact) => {
          try {
            await this.createContact(contact);
            results.success++;
          } catch (error) {
            results.failed++;
            results.errors.push({
              contact,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          }
        })
      );

      // Small delay between batches to respect rate limits
      if (i + batchSize < contacts.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    return results;
  }

  /**
   * Add a tag to a contact
   * CallTools API: POST /api/contacts/{id}/tag/
   */
  async addTagToContact(contactId: string, tagName: string): Promise<void> {
    const url = `${this.baseUrl}/api/contacts/${contactId}/tag/`;
    console.log(`Adding tag "${tagName}" to contact ${contactId}`);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tag: tagName,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Failed to add tag: ${response.status} - ${errorText}`);
      // Don't throw error - tagging failure shouldn't break the sync
      console.warn(`Tag "${tagName}" could not be added, continuing anyway`);
    } else {
      console.log(`Tag "${tagName}" added successfully`);
    }
  }

  /**
   * Get all buckets/lists
   */
  async getBuckets(): Promise<CallToolsBucket[]> {
    const response = await fetch(`${this.baseUrl}/api/lists/`, {
      method: 'GET',
      headers: {
        'Authorization': `Token ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `CallTools API error: ${response.status} - ${errorText}`
      );
    }

    const data: any = await response.json();
    return data.results || [];
  }

  /**
   * Get or create a bucket by name
   * Returns the bucket ID
   */
  async getOrCreateBucket(bucketName: string): Promise<string> {
    try {
      // First, try to get existing buckets
      const buckets = await this.getBuckets();
      const existingBucket = buckets.find(
        (b) => b.name.toLowerCase() === bucketName.toLowerCase()
      );

      if (existingBucket) {
        console.log(`Found existing bucket: ${bucketName} (${existingBucket.id})`);
        return existingBucket.id;
      }

      // If bucket doesn't exist, create it
      console.log(`Creating new bucket: ${bucketName}`);
      const response = await fetch(`${this.baseUrl}/api/buckets/`, {
        method: 'POST',
        headers: {
          'Authorization': `Token ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: bucketName,
          description: `Auto-created bucket for ${bucketName} contacts`,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `CallTools API error: ${response.status} - ${errorText}`
        );
      }

      const newBucket: CallToolsBucket = await response.json();
      console.log(`Created bucket: ${bucketName} (${newBucket.id})`);
      return newBucket.id;
    } catch (error) {
      console.error('Error getting/creating bucket:', error);
      throw error;
    }
  }

  /**
   * Add a contact to a bucket
   * CallTools uses PATCH with add_contacts array
   */
  async addContactToBucket(contactId: string, bucketId: string): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/api/buckets/${bucketId}/`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Token ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          add_contacts: [parseInt(contactId)],
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `CallTools API error: ${response.status} - ${errorText}`
      );
    }
  }

  /**
   * Remove a contact from a bucket
   * CallTools uses PATCH with remove_contacts array
   */
  async removeContactFromBucket(contactId: string, bucketId: string): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/api/buckets/${bucketId}/`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Token ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          remove_contacts: [parseInt(contactId)],
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `CallTools API error: ${response.status} - ${errorText}`
      );
    }
  }
}
