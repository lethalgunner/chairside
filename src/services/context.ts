import { can, type Capability, type Grant } from '@/domain/permissions';

/**
 * Who is acting, for which org, and where. Every service function takes one.
 * Tenancy in Pilot 0 is enforced here and by the org_id filter in every query
 * (ADR-012 defers row-level security until a second org exists).
 */
export interface TenantContext {
  orgId: string;
  userId: string;
  userName: string;
  grants: Grant[];
  /** Branches this user may see, in display order. */
  branchIds: string[];
  /** The branch selected in the switcher, or 'all' (view-only, multi-branch users). */
  activeBranchId: string | 'all';
}

export class ForbiddenError extends Error {
  constructor(message = 'You do not have permission to do that.') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/** An error whose message is safe and useful to show to clinic staff. */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserFacingError';
  }
}

export function canDo(ctx: TenantContext, capability: Capability, branchId: string): boolean {
  return ctx.branchIds.includes(branchId) && can(ctx.grants, capability, branchId);
}

export function assertCan(ctx: TenantContext, capability: Capability, branchId: string): void {
  if (!canDo(ctx, capability, branchId)) throw new ForbiddenError();
}

/** True when the user holds this capability at any of their branches. */
export function canAnywhere(ctx: TenantContext, capability: Capability): boolean {
  return ctx.branchIds.some((b) => can(ctx.grants, capability, b));
}

/**
 * Creating anything needs one concrete branch: a bill raised under
 * "All branches" would land in the wrong series, permanently.
 */
export function requireActiveBranch(ctx: TenantContext): string {
  if (ctx.activeBranchId === 'all') {
    throw new UserFacingError('Pick a branch in the branch menu before creating anything.');
  }
  return ctx.activeBranchId;
}

/** Branch ids a report should cover for the current switcher state. */
export function scopeBranchIds(ctx: TenantContext): string[] {
  return ctx.activeBranchId === 'all' ? ctx.branchIds : [ctx.activeBranchId];
}
