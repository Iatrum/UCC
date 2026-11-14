import { describe, expect, test } from 'bun:test';
import { fillTimeChitTemplate, isTimeChitProcedure, timeChitError, timeChitHours } from '../../lib/time-chit';
import { getEnabledModuleIdsFromOrganization } from '../../lib/module-settings';

describe('Time Chit boundaries', () => {
  test('requires positive same-day attendance and derives fractional hours', () => {
    expect(timeChitHours('09:00', '10:30')).toBe('1.5');
    expect(timeChitHours('09:00', '09:01')).toBe('0.02');
    for (const [start, end] of [['10:30', '09:00'], ['09:00', '09:00'], ['25:00', '26:00'], ['', '10:30'], ['9:00', '10:30']]) expect(timeChitHours(start, end)).toBeNull();
  });
  test('validates the actual calendar date and doctor name', () => {
    const valid = { tcDate: '2026-11-14', tcTimeIn: '09:00', tcTimeOut: '10:30', tcDoctorName: 'Dr Fake' };
    expect(timeChitError(valid)).toBeNull();
    for (const patch of [{ tcDate: '2026-02-30' }, { tcDate: 'invalid' }, { tcDoctorName: '  ' }, { tcTimeOut: '08:00' }]) expect(timeChitError({ ...valid, ...patch })).not.toBeNull();
  });
  test('default off without organization module settings', () => {
    expect(getEnabledModuleIdsFromOrganization({ resourceType: 'Organization' })).not.toContain('time-chit');
  });
  test('identifies direct catalog-id bypass as well as signed JSON', () => {
    expect(isTimeChitProcedure({ procedureId: 'letter-time-chit', notes: 'invalid' })).toBe(true);
    expect(isTimeChitProcedure({ notes: '{"kind":"time-chit"}' })).toBe(true);
    expect(isTimeChitProcedure({ notes: '{"kind":"mc"}' })).toBe(false);
  });
  test('attendance fields render as text, without HTML or recursive placeholder injection', () => {
    expect(fillTimeChitTemplate('{{patientName}} {{doctorName}}', { patientName: '<script>alert(1)</script>', doctorName: 'Dr {{patientName}}' }))
      .toBe('&lt;script&gt;alert(1)&lt;/script&gt; Dr {{patientName}}');
  });
});
