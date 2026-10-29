import { NextResponse } from 'next/server';
import { getContext } from '@/lib/auth';
import { ForbiddenError } from '@/services/context';
import { exportCsv, isExportKind } from '@/services/export';

/**
 * CSV download for "Export my data" (Sprint 3, T40). Thin: checks the session,
 * lets the service check `data.export` and audit, and never caches.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const ctx = await getContext();
  if (!ctx) return new NextResponse('Signed out. Sign in and try again.', { status: 401, headers: { 'Cache-Control': 'no-store' } });
  if (!isExportKind(kind)) return new NextResponse('Not found', { status: 404 });
  try {
    const { filename, csv } = await exportCsv(ctx, kind);
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    if (err instanceof ForbiddenError) return new NextResponse('Only the owner can export the clinic’s data.', { status: 403, headers: { 'Cache-Control': 'no-store' } });
    console.error('[export] failed', kind);
    return new NextResponse('Export failed. Try again.', { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
