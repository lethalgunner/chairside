import { describe, expect, it } from 'vitest';
import { checkSignup, signupEnabled, type SignupInput } from './signup';

const ok: SignupInput = {
  clinicName: ' Smile  Care ', fullName: 'Dr Meera Rao', email: ' Meera@SmileCare.IN ', password: 'long enough pw', confirm: 'long enough pw',
  branchCode: 'pun', branchName: 'Smile Care Baner', city: 'Pune', state: 'Maharashtra', gstRegistered: false, gstin: '', isDentist: true,
};

describe('clinic sign-up checks', () => {
  it('is off unless SIGNUP_ENABLED=1', () => {
    expect(signupEnabled({} as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(signupEnabled({ SIGNUP_ENABLED: 'true' } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(signupEnabled({ SIGNUP_ENABLED: '1' } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });
  it('tidies a good sign-up', () => {
    const r = checkSignup(ok);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ clinicName: 'Smile Care', email: 'meera@smilecare.in', branchCode: 'PUN', isDentist: true });
    expect(r.value.branch).toMatchObject({ name: 'Smile Care Baner', state: 'Maharashtra', gstRegistered: false, gstin: null, dayCloseTolerancePaise: 10_000 });
  });
  it('reports every bad field, with branch fields named for the form', () => {
    const r = checkSignup({ ...ok, clinicName: '', email: 'nope', password: 'short', branchCode: 'PUNE', branchName: '', state: '', gstRegistered: true });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.fieldErrors).sort()).toEqual(['branchCode', 'branchName', 'clinicName', 'email', 'gstin', 'password', 'state']);
  });
  it('catches a mismatched confirmation', () => {
    const r = checkSignup({ ...ok, confirm: 'something else' });
    expect(r.ok ? null : r.fieldErrors.confirm).toBe('The two passwords don’t match.');
  });
});
