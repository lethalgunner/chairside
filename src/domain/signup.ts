/**
 * Clinic sign-up (Sprint 7, self-serve). Pure checks; the service does the rest.
 * Sign-up only runs when SIGNUP_ENABLED=1 (see signupEnabled), so turning it on
 * is a decision, not a deploy side effect.
 */
import { checkBranchCode, checkBranchDetails, type BranchDetails } from './branch';
import { isPlausibleEmail, normaliseEmail, type Checked, type FieldErrors } from './staff';

export const MIN_SIGNUP_PASSWORD = 10;

export function signupEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SIGNUP_ENABLED === '1';
}

export interface SignupInput {
  clinicName: string;
  fullName: string;
  email: string;
  password: string;
  confirm: string;
  branchCode: string;
  branchName: string;
  city: string;
  state: string;
  gstRegistered: boolean;
  gstin: string;
  /** "I also treat patients": the owner gets a doctor profile at the branch. */
  isDentist: boolean;
}

export interface SignupValues {
  clinicName: string;
  fullName: string;
  email: string;
  password: string;
  branchCode: string;
  branch: BranchDetails;
  isDentist: boolean;
}

export function checkSignup(input: SignupInput): Checked<SignupValues> {
  const fieldErrors: FieldErrors = {};
  const clinicName = input.clinicName.trim().replace(/\s+/g, ' ');
  if (clinicName.length < 2 || clinicName.length > 80) fieldErrors.clinicName = 'Enter your clinic’s name (2 to 80 characters).';
  const fullName = input.fullName.trim().replace(/\s+/g, ' ');
  if (fullName.length < 2 || fullName.length > 80) fieldErrors.fullName = 'Enter your name (2 to 80 characters).';
  const email = normaliseEmail(input.email);
  if (!isPlausibleEmail(email)) fieldErrors.email = 'Enter an email like you@clinic.in.';
  if (input.password.length < MIN_SIGNUP_PASSWORD) fieldErrors.password = `Use at least ${MIN_SIGNUP_PASSWORD} characters.`;
  else if (input.password !== input.confirm) fieldErrors.confirm = 'The two passwords don’t match.';
  const code = checkBranchCode(input.branchCode);
  if (!code.ok) fieldErrors.branchCode = code.error;
  const branch = checkBranchDetails({
    name: input.branchName,
    addressLine: '',
    city: input.city,
    state: input.state,
    phone: '',
    gstRegistered: input.gstRegistered,
    gstin: input.gstin,
    dayCloseTolerance: '100',
    defaultFloat: '0',
  });
  if (!branch.ok) for (const [k, v] of Object.entries(branch.fieldErrors)) fieldErrors[k === 'name' ? 'branchName' : k] = v;
  if (Object.keys(fieldErrors).length > 0 || !code.ok || !branch.ok) return { ok: false, fieldErrors };
  return { ok: true, value: { clinicName, fullName, email, password: input.password, branchCode: code.code, branch: branch.value, isDentist: input.isDentist } };
}
