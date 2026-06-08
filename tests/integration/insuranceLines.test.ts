import { describe, it, expect } from 'vitest';
import { getInsuranceLines, matchInsuranceLine } from '../../src/config/insuranceLines';

const lines = getInsuranceLines({});

function match(tags: string[]) {
  const m = matchInsuranceLine(tags, lines);
  return m ? { line: m.line.key, state: m.state.name, bucket: m.state.bucketId } : null;
}

describe('Auto Insurance routing', () => {
  it('routes "auto – autoquote click" to the Auto Hot Leads bucket and removes Cold', () => {
    const m = matchInsuranceLine(['auto – autoquote click'], lines)!;
    expect(m.line.key).toBe('auto');
    expect(m.state.name).toBe('hot');
    expect(m.state.bucketId).toBe('11879');
    expect(m.state.tag).toBe('Auto Insurance Hot Leads');
    expect(m.state.removeBucketIds).toContain('11880');
    expect(m.state.removeTags).toContain('Auto Insurance Cold Leads');
  });

  it('routes the "Auto Insurance Hot Leads" tag to the Hot bucket', () => {
    expect(match(['Auto Insurance Hot Leads'])?.state).toBe('hot');
  });

  it('routes "cold_lead_auto" to the Auto Cold Leads bucket and removes Hot', () => {
    const m = matchInsuranceLine(['cold_lead_auto'], lines)!;
    expect(m.line.key).toBe('auto');
    expect(m.state.name).toBe('cold');
    expect(m.state.bucketId).toBe('11880');
    expect(m.state.tag).toBe('Auto Insurance Cold Leads');
    expect(m.state.removeBucketIds).toContain('11879');
    expect(m.state.removeTags).toContain('Auto Insurance Hot Leads');
  });

  it('routes the "Auto Insurance Cold Leads" tag to the Cold bucket', () => {
    expect(match(['Auto Insurance Cold Leads'])?.state).toBe('cold');
  });

  it('routes "auto – active" to the Auto Active Clients bucket and removes Cold + Hot', () => {
    const m = matchInsuranceLine(['auto – active'], lines)!;
    expect(m.line.key).toBe('auto');
    expect(m.state.name).toBe('active');
    expect(m.state.bucketId).toBe('11881');
    expect(m.state.tag).toBe('auto – active');
    expect(m.state.isCustomer).toBe(true);
    expect(m.state.removeBucketIds).toEqual(expect.arrayContaining(['11880', '11879']));
    expect(m.state.removeTags).toEqual(
      expect.arrayContaining(['Auto Insurance Cold Leads', 'Auto Insurance Hot Leads'])
    );
  });

  it('prefers hot over cold when both tags are present (re-engagement wins)', () => {
    // A cold lead showing renewed buying intent should land in Hot (removes Cold)
    expect(match(['cold_lead_auto', 'auto – autoquote click'])?.state).toBe('hot');
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
  it('routes a generic cold lead to the ACA Cold bucket with the ACA Cold Lead tag', () => {
    const m = matchInsuranceLine(['cold lead'], lines)!;
    expect(m.line.key).toBe('aca');
    expect(m.state.name).toBe('cold');
    expect(m.state.bucketId).toBe('11237');
    expect(m.state.tag).toBe('ACA Cold Lead');
  });

  it('routes "ACA Active 2026" to the ACA Active bucket with the ACA Active Client tag', () => {
    const m = matchInsuranceLine(['ACA Active 2026'], lines)!;
    expect(m.line.key).toBe('aca');
    expect(m.state.name).toBe('active');
    expect(m.state.bucketId).toBe('11252');
    expect(m.state.tag).toBe('ACA Active Client');
    expect(m.state.removeTags).toContain('ACA Cold Lead');
  });

  it('returns null when no insurance tag is present', () => {
    expect(match(['random tag', 'newsletter'])).toBeNull();
  });
});
