/**
 * CallTools API Client
 * For managing contacts in the CallTools dialer system
 */

export interface CallToolsContact {
  first_name: string;
  last_name?: string;
  mobile_phone_number?: string; // Primary phone field in CallTools
  email?: string;
  personal_email_address?: string; // CallTools email field
  bucket_id?: string; // Bucket/List ID to add contact to
  custom_fields?: Record<string, any>;
}

export interface CallToolsContactResponse {
  id: string;
  first_name: string;
  last_name?: string;
  mobile_phone_number?: string;
  home_phone_number?: string;
  office_phone_number?: string;
  personal_email_address?: string;
  email?: string;
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
    if (!apiKey) {
      throw new Error('CallTools API key is required but was not provided. Check CALLTOOLS_API_KEY environment variable.');
    }
    this.apiKey = apiKey;
    if (baseUrl) {
      this.baseUrl = baseUrl;
    }
    console.log(`CallTools client initialized with API key length: ${this.apiKey.length}`);
  }

  /**
   * Create a new contact in CallTools
   */
  async createContact(contact: CallToolsContact): Promise<CallToolsContactResponse> {
    const url = `${this.baseUrl}/api/contacts/`;
    console.log(`Creating contact at: ${url}`);
    console.log(`Contact data:`, JSON.stringify(contact));
    console.log(`API key length: ${this.apiKey.length}`);
    console.log(`API key (first 10 chars): ${this.apiKey.substring(0, 10)}...`);
    console.log(`API key (last 10 chars): ...${this.apiKey.substring(this.apiKey.length - 10)}`);
    
    // Use Token format as per CallTools documentation
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
   * Get a contact by phone number
   * CallTools API doesn't support external_id search, so we search by phone
   */
  async getContactByExternalId(externalId: string, phoneNumber?: string): Promise<CallToolsContactResponse | null> {
    try {
      // CallTools doesn't support external_id search, we must search by phone number
      if (!phoneNumber) {
        console.log(`No phone number provided, cannot search for contact`);
        return null;
      }

      console.log(`Searching for contact by phone: ${phoneNumber}`);
      
      // Try to match the format stored in CallTools (_phone_numbers array)
      // CallTools stores phone numbers in E.164 format with + prefix
      let searchPhone = phoneNumber;
      if (!searchPhone.startsWith('+')) {
        // If no country code, assume US (+1)
        const digitsOnly = searchPhone.replace(/[\s\-\(\)]/g, '');
        if (digitsOnly.length === 10) {
          searchPhone = `+1${digitsOnly}`;
        } else if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
          searchPhone = `+${digitsOnly}`;
        } else {
          searchPhone = `+${digitsOnly}`;
        }
      }
      console.log(`Searching with phone_number parameter: ${searchPhone}`);
      
      // Use phone_number query parameter (documented in CallTools API)
      const response = await fetch(
        `${this.baseUrl}/api/contacts/?phone_number=${encodeURIComponent(searchPhone)}`,
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
          console.log(`No contact found with phone: ${phoneNumber} (404)`);
          return null;
        }
        const errorText = await response.text();
        throw new Error(
          `CallTools API error: ${response.status} - ${errorText}`
        );
      }

      const data: any = await response.json();
      const contacts = data.results || data.contacts || [];
      console.log(`phone_number query returned ${contacts.length} contacts`);
      
      if (contacts.length > 0) {
        // Return the first match
        console.log(`Found contact: ID ${contacts[0].id}, Name: ${contacts[0].first_name} ${contacts[0].last_name}`);
        return contacts[0];
      } else {
        console.log(`No contact found with phone: ${phoneNumber}`);
        return null;
      }
    } catch (error) {
      console.error('Error fetching contact by phone:', error);
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
    console.log(`Adding tag "${tagName}" to contact ${contactId}`);
    
    try {
      // Step 1: Find or create the tag
      const searchUrl = `${this.baseUrl}/api/alltags/?name=${encodeURIComponent(tagName)}`;
      const searchResponse = await fetch(searchUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Token ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!searchResponse.ok) {
        throw new Error(`Failed to search for tag: ${searchResponse.status}`);
      }

      const searchData = await searchResponse.json();
      let tagId: number;

      if (searchData.results && searchData.results.length > 0) {
        // Tag exists, use it
        tagId = searchData.results[0].id;
        console.log(`Found existing tag "${tagName}" with ID: ${tagId}`);
      } else {
        // Tag doesn't exist, create it
        console.log(`Tag "${tagName}" not found, creating it...`);
        const createResponse = await fetch(`${this.baseUrl}/api/alltags/`, {
          method: 'POST',
          headers: {
            'Authorization': `Token ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: tagName,
          }),
        });

        if (!createResponse.ok) {
          throw new Error(`Failed to create tag: ${createResponse.status}`);
        }

        const newTag = await createResponse.json();
        tagId = newTag.id;
        console.log(`Created new tag "${tagName}" with ID: ${tagId}`);
      }

      // Step 2: Add contact to the tag
      const addResponse = await fetch(`${this.baseUrl}/api/alltags/${tagId}/`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Token ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          add_contacts: [parseInt(contactId)],
        }),
      });

      if (!addResponse.ok) {
        const errorText = await addResponse.text();
        throw new Error(`Failed to add contact to tag: ${addResponse.status} - ${errorText}`);
      }

      console.log(`Successfully added contact ${contactId} to tag "${tagName}"`);
    } catch (error) {
      console.error(`Error adding tag: ${error}`);
      // Don't throw error - tagging failure shouldn't break the sync
      console.warn(`Tag "${tagName}" could not be added, continuing anyway`);
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

  /**
   * Remove a tag from a contact
   * CallTools API: PATCH /api/alltags/{tagId}/ with remove_contacts
   */
  async removeTagFromContact(contactId: string, tagName: string): Promise<void> {
    console.log(`Removing tag "${tagName}" from contact ${contactId}`);
    
    try {
      // Step 1: Find the tag
      const searchUrl = `${this.baseUrl}/api/alltags/?name=${encodeURIComponent(tagName)}`;
      const searchResponse = await fetch(searchUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Token ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!searchResponse.ok) {
        throw new Error(`Failed to search for tag: ${searchResponse.status}`);
      }

      const searchData = await searchResponse.json();

      if (!searchData.results || searchData.results.length === 0) {
        // Tag doesn't exist, nothing to remove
        console.log(`Tag "${tagName}" not found, nothing to remove`);
        return;
      }

      const tagId = searchData.results[0].id;
      console.log(`Found tag "${tagName}" with ID: ${tagId}`);

      // Step 2: Remove contact from the tag
      const removeResponse = await fetch(`${this.baseUrl}/api/alltags/${tagId}/`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Token ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          remove_contacts: [parseInt(contactId)],
        }),
      });

      if (!removeResponse.ok) {
        const errorText = await removeResponse.text();
        throw new Error(`Failed to remove contact from tag: ${removeResponse.status} - ${errorText}`);
      }

      console.log(`Successfully removed contact ${contactId} from tag "${tagName}"`);
    } catch (error) {
      console.error(`Error removing tag: ${error}`);
      // Don't throw error - tag removal failure shouldn't break the sync
      console.warn(`Tag "${tagName}" could not be removed, continuing anyway`);
    }
  }
}
