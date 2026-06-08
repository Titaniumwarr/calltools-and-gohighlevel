import { describe, it, expect } from 'vitest';
import { getInsuranceLines, matchInsuranceLine } from '../../src/config/insuranceLines';

const lines = getInsuranceLines({});

function match(tags: string[]) {
  const m = matchInsuranceLine(tags, lines);
  return m ? { line: m.line.key, state: m.state.name, bucket: m.state.bucketId } : null;
}

describe('Auto Insurance routing', () => {
  it('routes "auto – autoquote click" to the Auto Hot Leads bucket', () => {
    expect(match(['auto – autoquote click'])).toEqual({
      line: 'auto',
      state: 'hot',
      bucket: '11879',
    });
  });

  it('routes "cold_lead_auto" to the Auto Cold Leads bucket and removes Hot', () => {
    const m = matchInsuranceLine(['cold_lead_auto'], lines)!;
    expect(m.line.key).toBe('auto');
    expect(m.state.name).toBe('cold');
    expect(m.state.bucketId).toBe('11880');
    expect(m.state.removeBucketIds).toContain('11879');
    expect(m.state.removeTags).toContain('Auto Hot lead');
  });

  it('routes "auto – active" to the Auto Active Clients bucket and removes Cold + Hot', () => {
    const m = matchInsuranceLine(['auto – active'], lines)!;
    expect(m.line.key).toBe('auto');
    expect(m.state.name).toBe('active');
    expect(m.state.bucketId).toBe('11881');
    expect(m.state.isCustomer).toBe(true);
    expect(m.state.removeBucketIds).toEqual(expect.arrayContaining(['11880', '11879']));
    expect(m.state.removeTags).toEqual(expect.arrayContaining(['Auto Cold lead', 'Auto Hot lead']));
  });

  it('prefers cold over hot when both tags are present (cold wins)', () => {
    // A lead that was hot, then tagged cold, should land in Cold (and removes Hot)
    expect(match(['auto – autoquote click', 'cold_lead_auto'])?.state).toBe('cold');
  });

  it('prefers active over everything when all tags are present', () => {
    expect(
      match(['auto – autoquote click', 'cold_lead_auto', 'auto – active'])?.state
    ).toBe('active');
  });

  it('matches regardless of dash style or casing', () => {
    expect(match(['AUTO - ACTIVE'])?.state).toBe('active');
    expect(match(['Auto — Autoquote Click'])?.state).toBe('hot');
  });
});

describe('ACA Insurance routing (unchanged)', () => {
  it('routes a generic cold lead to the ACA Cold bucket', () => {
    expect(match(['cold lead'])).toEqual({
      line: 'aca',
      state: 'cold',
      bucket: '11237',
    });
  });

  it('routes "ACA Active 2026" to the ACA Active bucket', () => {
    const m = matchInsuranceLine(['ACA Active 2026'], lines)!;
    expect(m.line.key).toBe('aca');
    expect(m.state.name).toBe('active');
    expect(m.state.bucketId).toBe('11252');
  });

  it('returns null when no insurance tag is present', () => {
    expect(match(['random tag', 'newsletter'])).toBeNull();
  });
});
