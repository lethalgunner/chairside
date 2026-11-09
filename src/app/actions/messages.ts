'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getContext } from '@/lib/auth';
import { ForbiddenError, requireActiveBranch } from '@/services/context';
import { addRule, addSuggestedReminders, markMessage, removeRule, removeTemplate, saveMessageOptions, saveTemplate, setMessagesStopped, setRuleActive } from '@/services/messages';
import type { FieldErrors } from '@/domain/staff';
import { run, signedOut, type ActionResult } from './run';

/** Reminders (Sprint 8, ADR-020). Thin: parse, then the service checks who may. */

type Saved<T = object> = ({ ok: true } & T) | { ok: false; fieldErrors: FieldErrors };
const id = z.string().uuid();

function parse<T>(schema: z.ZodType<T>, v: unknown): T {
  const r = schema.safeParse(v);
  if (!r.success) throw new ForbiddenError();
  return r.data;
}
function refresh() {
  revalidatePath('/', 'layout');
}

export async function saveMessageOptionsAction(input: { quietStart: string; quietEnd: string; doctorName: boolean }): Promise<ActionResult<Saved>> {
  const ctx = await getContext();
  if (!ctx) return signedOut('messages.options');
  const res = await run('messages.options', () => saveMessageOptions(ctx, parse(z.object({ quietStart: z.string().max(5), quietEnd: z.string().max(5), doctorName: z.boolean() }), input)));
  if (res.ok && res.data.ok) refresh();
  return res;
}

export async function saveTemplateAction(templateId: string | null, input: { name: string; language: string; body: string }): Promise<ActionResult<Saved<{ id: string }>>> {
  const ctx = await getContext();
  if (!ctx) return signedOut('messages.template');
  const res = await run('messages.template', () =>
    saveTemplate(ctx, templateId === null ? null : parse(id, templateId), parse(z.object({ name: z.string().max(200), language: z.string().max(5), body: z.string().max(2000) }), input)),
  );
  if (res.ok && res.data.ok) refresh();
  return res;
}

export async function removeTemplateAction(templateId: string): Promise<ActionResult> {
  const ctx = await getContext();
  if (!ctx) return signedOut('messages.template_remove');
  const res = await run('messages.template_remove', async () => {
    await removeTemplate(ctx, parse(id, templateId));
    return undefined;
  });
  if (res.ok) refresh();
  return res;
}

const ruleInput = z.object({
  trigger: z.string().max(40),
  amount: z.string().max(6),
  unit: z.string().max(10),
  everyDays: z.string().max(6),
  maxTimes: z.string().max(6),
  templateId: z.string().max(40),
  branchId: z.string().max(40),
});

export async function addRuleAction(input: z.input<typeof ruleInput>): Promise<ActionResult<Saved<{ id: string }>>> {
  const ctx = await getContext();
  if (!ctx) return signedOut('messages.rule_add');
  const res = await run('messages.rule_add', () => addRule(ctx, parse(ruleInput, input)));
  if (res.ok && res.data.ok) refresh();
  return res;
}

export async function setRuleActiveAction(ruleId: string, active: boolean): Promise<ActionResult> {
  const ctx = await getContext();
  if (!ctx) return signedOut('messages.rule_active');
  const res = await run('messages.rule_active', async () => {
    await setRuleActive(ctx, parse(id, ruleId), parse(z.boolean(), active));
    return undefined;
  });
  if (res.ok) refresh();
  return res;
}

export async function removeRuleAction(ruleId: string): Promise<ActionResult> {
  const ctx = await getContext();
  if (!ctx) return signedOut('messages.rule_remove');
  const res = await run('messages.rule_remove', async () => {
    await removeRule(ctx, parse(id, ruleId));
    return undefined;
  });
  if (res.ok) refresh();
  return res;
}

export async function addSuggestedRemindersAction(): Promise<ActionResult> {
  const ctx = await getContext();
  if (!ctx) return signedOut('messages.suggested');
  const res = await run('messages.suggested', async () => {
    await addSuggestedReminders(ctx);
    return undefined;
  });
  if (res.ok) refresh();
  return res;
}

/** Today's messages: the desk tapped Send or Skip. At the active branch only. */
export async function markMessageAction(key: string, outcome: 'sent' | 'skipped'): Promise<ActionResult> {
  const ctx = await getContext();
  if (!ctx) return signedOut('message.mark');
  const res = await run('message.mark', async () => {
    await markMessage(ctx, requireActiveBranch(ctx), parse(z.string().min(36).max(300), key), parse(z.enum(['sent', 'skipped']), outcome));
    return undefined;
  });
  if (res.ok) refresh();
  return res;
}

export async function setMessagesStoppedAction(patientId: string, stopped: boolean): Promise<ActionResult> {
  const ctx = await getContext();
  if (!ctx) return signedOut('patient.messages_stop');
  const res = await run('patient.messages_stop', async () => {
    await setMessagesStopped(ctx, parse(id, patientId), parse(z.boolean(), stopped));
    return undefined;
  });
  if (res.ok) refresh();
  return res;
}
