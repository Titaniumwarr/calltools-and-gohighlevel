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
  custom_fields?: Record<string, any>;
}

export interface CallToolsContactResponse {
  id: string;
  first_name: string;
  last_name?: string;
  phone_number: string;
  email?: string;
  external_id?: string;
  created_at?: string;
  updated_at?: string;
}

export interface CallToolsListResponse {
  contacts: CallToolsContactResponse[];
  total?: number;
  page?: number;
  per_page?: number;
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
    const response = await fetch(`${this.baseUrl}/contacts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
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
   * Update an existing contact in CallTools
   */
  async updateContact(
    contactId: string,
    contact: Partial<CallToolsContact>
  ): Promise<CallToolsContactResponse> {
    const response = await fetch(`${this.baseUrl}/contacts/${contactId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
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
        `${this.baseUrl}/contacts?external_id=${encodeURIComponent(externalId)}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
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
    const response = await fetch(`${this.baseUrl}/contacts/${contactId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
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
}
