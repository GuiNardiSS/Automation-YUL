import { describe, expect, it } from 'vitest';
import { isWithinBusinessHours } from '../src/scheduler.js';

// America/Sao_Paulo has been fixed at UTC-3 year-round since Brazil abolished DST in 2019,
// so a UTC instant maps to a local hour by simply subtracting 3.
function utcInstantForSaoPauloTime(hour: number, minute: number): Date {
  return new Date(Date.UTC(2026, 7, 27, hour + 3, minute, 0));
}

describe('isWithinBusinessHours', () => {
  it('is false one minute before the business-hours window opens (07:59)', () => {
    expect(isWithinBusinessHours(utcInstantForSaoPauloTime(7, 59), 'America/Sao_Paulo')).toBe(false);
  });

  it('is true at the moment the window opens (08:00)', () => {
    expect(isWithinBusinessHours(utcInstantForSaoPauloTime(8, 0), 'America/Sao_Paulo')).toBe(true);
  });

  it('is true one minute before the window closes (17:59)', () => {
    expect(isWithinBusinessHours(utcInstantForSaoPauloTime(17, 59), 'America/Sao_Paulo')).toBe(true);
  });

  it('is false at the moment the window closes (18:00)', () => {
    expect(isWithinBusinessHours(utcInstantForSaoPauloTime(18, 0), 'America/Sao_Paulo')).toBe(false);
  });

  it('is false well outside the window (03:00)', () => {
    expect(isWithinBusinessHours(utcInstantForSaoPauloTime(3, 0), 'America/Sao_Paulo')).toBe(false);
  });

  it('actually uses the timezone parameter rather than assuming a fixed offset', () => {
    // This instant is 17:30 in America/Sao_Paulo (UTC-3, within business hours)
    // but 20:30 UTC (outside business hours). An implementation that ignores
    // the timezone argument and hardcodes Sao Paulo's offset would incorrectly
    // return true for the UTC case too.
    const instant = utcInstantForSaoPauloTime(17, 30);
    expect(isWithinBusinessHours(instant, 'America/Sao_Paulo')).toBe(true);
    expect(isWithinBusinessHours(instant, 'UTC')).toBe(false);
  });
});
