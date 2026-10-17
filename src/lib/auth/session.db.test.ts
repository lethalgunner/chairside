import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/db/client';
import { createFixture, type Fixture } from '@/test/fixtures';
import { contextFromSession, MAX_FAILURES, revokeSession, signInWithPassword } from './session';

let f: Fixture;
beforeAll(async () => {
  f = await createFixture();
});
afterAll(async () => {
  await closeDb();
});

describe('password sign-in and sessions', () => {
  it('signs in, resolves a context, and revokes', async () => {
    const res = await signInWithPassword(f.emails.desk.toUpperCase(), f.password);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const resolved = await contextFromSession(res.sessionId, undefined);
    expect(resolved?.ctx.branchIds).toEqual([f.pune.id]);
    expect(resolved?.ctx.activeBranchId).toBe(f.pune.id);
    await revokeSession(res.sessionId);
    expect(await contextFromSession(res.sessionId, undefined)).toBeNull();
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const a = await signInWithPassword(f.emails.manager, 'wrong password!!');
    const b = await signInWithPassword('nobody@test.local', 'wrong password!!');
    expect(a).toEqual(b);
  });

  it('locks an email after repeated failures', async () => {
    for (let i = 0; i < MAX_FAILURES; i++) await signInWithPassword(f.emails.accountant, 'nope nope nope');
    const res = await signInWithPassword(f.emails.accountant, f.password);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Too many/);
  });

  it('lets a multi-branch owner choose All branches, but not a single-branch user', async () => {
    const owner = await signInWithPassword(f.emails.owner, f.password);
    const desk = await signInWithPassword(f.emails.desk, f.password);
    if (!owner.ok || !desk.ok) throw new Error();
    expect((await contextFromSession(owner.sessionId, 'all'))?.ctx.activeBranchId).toBe('all');
    expect((await contextFromSession(owner.sessionId, f.kanpur.id))?.ctx.activeBranchId).toBe(f.kanpur.id);
    expect((await contextFromSession(desk.sessionId, f.kanpur.id))?.ctx.activeBranchId).toBe(f.pune.id);
    expect((await contextFromSession('not-a-session', undefined))).toBeNull();
  });
});
