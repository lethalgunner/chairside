import { canOrgWide } from '@/domain/permissions';
import type { TenantContext } from './context';

/** Which owner settings this user may open. The sidebar shows Settings when any is true. */
export interface SettingsAccess {
  team: boolean;
}

export function settingsAccess(ctx: TenantContext): SettingsAccess {
  return {
    team: canOrgWide(ctx.grants, 'staff.manage'),
  };
}

export function hasAnySettings(a: SettingsAccess): boolean {
  return Object.values(a).some(Boolean);
}
