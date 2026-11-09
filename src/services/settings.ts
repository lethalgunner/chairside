import { canOrgWide } from '@/domain/permissions';
import { canAnywhere, type TenantContext } from './context';

/** Which owner settings this user may open. The sidebar shows Settings when any is true. */
export interface SettingsAccess {
  team: boolean;
  catalogue: boolean;
  branches: boolean;
  /** Export my data (Sprint 3, T40). */
  export: boolean;
  /** Doctor profiles and hours (Sprint 4, LET-166). */
  doctors: boolean;
  /** The printed header on bills (Sprint 5, LET-174). Owner only. */
  print: boolean;
  /** Medicines and prescription templates (Sprint 5, LET-172). */
  medicines: boolean;
  /** Clinic name and the parallel-run switch (Sprint 7). Owner only. */
  clinic: boolean;
}

export function settingsAccess(ctx: TenantContext): SettingsAccess {
  return {
    team: canOrgWide(ctx.grants, 'staff.manage'),
    catalogue: canAnywhere(ctx, 'catalogue.manage'),
    branches: canAnywhere(ctx, 'branch.manage'),
    export: canOrgWide(ctx.grants, 'data.export'),
    doctors: canAnywhere(ctx, 'provider.manage'),
    print: canAnywhere(ctx, 'branch.manage'),
    medicines: canAnywhere(ctx, 'medicine.manage'),
    clinic: canOrgWide(ctx.grants, 'staff.manage'),
  };
}

export function hasAnySettings(a: SettingsAccess): boolean {
  return Object.values(a).some(Boolean);
}
