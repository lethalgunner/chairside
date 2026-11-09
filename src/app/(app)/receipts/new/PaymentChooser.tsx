'use client';

import { useState } from 'react';
import type { OutstandingInvoice } from '@/domain/ledger';
import type { Paise } from '@/domain/money';
import ReceiptForm from './ReceiptForm';
import SplitForm from './SplitForm';

/** The one-way payment form as before, with "Paid more than one way?" switching to the split form (Sprint 9). */
export default function PaymentChooser(props: { patient: { id: string; name: string }; branchName: string; open: (OutstandingInvoice & { number: string })[]; balancePaise: Paise; initialAmount?: string }) {
  const [split, setSplit] = useState(false);
  if (split) return <SplitForm patient={props.patient} branchName={props.branchName} open={props.open} onCancel={() => setSplit(false)} />;
  return (
    <>
      <ReceiptForm {...props} />
      <p className="small">
        <button type="button" className="linkish" onClick={() => setSplit(true)}>Paid more than one way? Split the payment</button>
      </p>
    </>
  );
}
