'use client';

/** Opens the browser's print dialog, where "Save as PDF" makes the PDF. */
export default function PrintButton({ label = 'Print or save as PDF' }: { label?: string }) {
  return (
    <button type="button" className="primary" onClick={() => window.print()}>
      {label}
    </button>
  );
}
