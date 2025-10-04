/**
 * Webhook Verification Service
 * Verifies incoming webhooks from GoHighLevel
 */

export class WebhookVerificationService {
  private webhookSecret: string;

  constructor(webhookSecret: string) {
    this.webhookSecret = webhookSecret;
  }

  /**
   * Verify GoHighLevel webhook signature
   * GHL sends a signature in the X-GHL-Signature header
   */
  async verifySignature(
    payload: string,
    signature: string | null
  ): Promise<boolean> {
    if (!signature) {
      console.warn('No webhook signature provided');
      return false;
    }

    try {
      // GoHighLevel uses HMAC-SHA256 for webhook signatures
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(this.webhookSecret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign', 'verify']
      );

      const signatureBuffer = await crypto.subtle.sign(
        'HMAC',
        key,
        encoder.encode(payload)
      );

      const expectedSignature = Array.from(new Uint8Array(signatureBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      // Compare signatures (constant-time comparison)
      return this.constantTimeCompare(signature, expectedSignature);
    } catch (error) {
      console.error('Error verifying webhook signature:', error);
      return false;
    }
  }

  /**
   * Constant-time string comparison to prevent timing attacks
   */
  private constantTimeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }

    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }

    return result === 0;
  }

  /**
   * Verify webhook timestamp to prevent replay attacks
   * Rejects webhooks older than 5 minutes
   */
  verifyTimestamp(timestamp: number): boolean {
    const now = Date.now();
    const maxAge = 5 * 60 * 1000; // 5 minutes in milliseconds

    const age = now - timestamp;
    
    if (age < 0) {
      console.warn('Webhook timestamp is in the future');
      return false;
    }

    if (age > maxAge) {
      console.warn(`Webhook is too old: ${age}ms`);
      return false;
    }

    return true;
  }
}
