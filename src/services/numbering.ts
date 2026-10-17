import { sql } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { financialYear, financialYearShort } from '@/domain/dates';
import { formatDocumentNumber, type DocumentType } from '@/domain/numbering';
import { testSeriesEnabled, toInt } from './util';

/**
 * Next gapless number for a branch's series in the FY of `businessDate`.
 *
 * The UPDATE takes a row lock that is held until the surrounding transaction
 * ends: concurrent issuers queue behind it, and a rolled-back transaction
 * gives its number back. A sequence would leak numbers on rollback.
 */
export async function nextDocumentNumber(
  tx: Tx,
  params: { orgId: string; branchId: string; branchCode: string; documentType: DocumentType; businessDate: string },
): Promise<{ number: string; financialYear: string }> {
  const fy = financialYear(params.businessDate);
  await tx.execute(sql`
    insert into invoice_series (org_id, branch_id, financial_year, document_type, last_number)
    values (${params.orgId}, ${params.branchId}, ${fy}, ${params.documentType}, 0)
    on conflict (branch_id, financial_year, document_type) do nothing`);
  const rows = await tx.execute(sql`
    update invoice_series set last_number = last_number + 1
    where branch_id = ${params.branchId} and financial_year = ${fy}
      and document_type = ${params.documentType} and org_id = ${params.orgId}
    returning last_number`);
  const seq = toInt((rows as unknown as { last_number: unknown }[])[0]?.last_number);
  return {
    financialYear: fy,
    number: formatDocumentNumber({
      branchCode: params.branchCode,
      documentType: params.documentType,
      fyShort: financialYearShort(params.businessDate),
      sequence: seq,
      testSeries: testSeriesEnabled(),
    }),
  };
}
