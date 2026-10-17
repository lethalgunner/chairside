/**
 * Document numbers (ADR-010).
 *
 * CGST Rules 46/49/53 cap a serial at 16 characters of letters, digits, '-' and
 * '/', unique per financial year. Format: {BRANCH}{T?}{R|C?}/{YY-YY}/{NNNNN}.
 * The 'T' marks Pilot 0 test documents (ADR-012) so nobody mistakes them for
 * legal bills. The sequence is zero-padded to fill the remaining width, and
 * this function throws rather than produce an over-long number.
 */

export type DocumentType = 'sale' | 'receipt' | 'credit_note';

export const MAX_DOCUMENT_NUMBER_LENGTH = 16;

const TYPE_SUFFIX: Record<DocumentType, string> = { sale: '', receipt: 'R', credit_note: 'C' };

export class NumberingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NumberingError';
  }
}

export function isValidBranchCode(code: string): boolean {
  return /^[A-Z0-9]{3}$/.test(code);
}

export function formatDocumentNumber(params: {
  branchCode: string;
  documentType: DocumentType;
  fyShort: string; // '26-27'
  sequence: number;
  testSeries: boolean;
}): string {
  const { branchCode, documentType, fyShort, sequence, testSeries } = params;
  if (!isValidBranchCode(branchCode)) {
    throw new NumberingError(`Branch code '${branchCode}' must be exactly 3 letters or digits.`);
  }
  if (!/^\d{2}-\d{2}$/.test(fyShort)) {
    throw new NumberingError(`Financial year '${fyShort}' must look like 26-27.`);
  }
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new NumberingError(`Sequence must be a positive whole number, got ${sequence}.`);
  }
  const prefix = `${branchCode}${testSeries ? 'T' : ''}${TYPE_SUFFIX[documentType]}`;
  const width = MAX_DOCUMENT_NUMBER_LENGTH - prefix.length - fyShort.length - 2;
  const digits = String(sequence);
  if (digits.length > width) {
    throw new NumberingError(
      `Series ${prefix}/${fyShort} is full: sequence ${sequence} needs more than ${width} digits.`,
    );
  }
  return `${prefix}/${fyShort}/${digits.padStart(width, '0')}`;
}
