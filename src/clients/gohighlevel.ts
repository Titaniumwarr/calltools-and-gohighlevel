/**
 * GoHighLevel API Client
 * Documentation: https://highlevel.stoplight.io/docs/integrations/
 */

export interface GHLContact {
  id: string;
  name: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  tags?: string[];
  customFields?: Record<string, any>;
  dateAdded?: string;
}

export interface GHLContactsResponse {
  contacts: GHLContact[];
  meta?: {
    total: number;
    nextPageUrl?: string;
  };
}

export class GoHighLevelClient {
  private apiKey: string;
  private baseUrl: string = 'https://rest.gohighlevel.com/v1';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Fetch contacts from GoHighLevel with optional filters
   */
  async getContacts(params?: {
    tags?: string[];
    query?: string;
    limit?: number;
    skip?: number;
  }): Promise<GHLContactsResponse> {
    const queryParams = new URLSearchParams();
    
    if (params?.tags && params.tags.length > 0) {
      params.tags.forEach(tag => queryParams.append('tags', tag));
    }
    
    if (params?.query) {
      queryParams.set('query', params.query);
    }
    
    if (params?.limit) {
      queryParams.set('limit', params.limit.toString());
    }
    
    if (params?.skip) {
      queryParams.set('skip', params.skip.toString());
    }

    const response = await fetch(
      `${this.baseUrl}/contacts/?${queryParams.toString()}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `GoHighLevel API error: ${response.status} - ${errorText}`
      );
    }

    return await response.json();
  }

  /**
   * Get cold contacts (contacts with "cold lead" tag)
   * Excluding customers (contacts with "customer" tag or in customer pipeline stage)
   */
  async getColdContactsExcludingCustomers(): Promise<GHLContact[]> {
    const allContacts: GHLContact[] = [];
    let skip = 0;
    const limit = 100;
    let hasMore = true;

    // Fetch all contacts in batches
    while (hasMore) {
      const response = await this.getContacts({ limit, skip });
      
      if (response.contacts && response.contacts.length > 0) {
        allContacts.push(...response.contacts);
        skip += limit;
        
        // Check if there are more pages
        hasMore = response.contacts.length === limit;
      } else {
        hasMore = false;
      }
    }

    // Filter for cold contacts, excluding customers
    const coldContacts = allContacts.filter(contact => {
      const tags = (contact.tags || []).map(t => t.toLowerCase());
      
      // Check if contact is a customer (exclude these)
      const isCustomer = tags.some(tag => 
        tag.includes('customer') || 
        tag.includes('client') ||
        tag.includes('won') ||
        tag.includes('purchased')
      );
      
      if (isCustomer) {
        return false;
      }
      
      // Check if contact has "cold lead" tag
      const isCold = tags.some(tag => 
        tag === 'cold lead' ||
        tag.includes('cold') ||
        tag.includes('new lead') ||
        tag.includes('prospect')
      );
      
      return isCold;
    });

    return coldContacts;
  }

  /**
   * Get a specific contact by ID
   */
  async getContact(contactId: string): Promise<GHLContact> {
    const response = await fetch(
      `${this.baseUrl}/contacts/${contactId}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `GoHighLevel API error: ${response.status} - ${errorText}`
      );
    }

    const data = await response.json() as { contact: GHLContact };
    return data.contact;
  }
}
