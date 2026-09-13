import { PageHead } from '@/components/ui';
import NewPatientForm from '@/components/NewPatientForm';
import { PATIENTS, BRANCH } from '@/lib/seed';

export const dynamic = 'force-dynamic';

export default function NewPatientPage() {
  const existing = PATIENTS.map((p) => ({
    id: p.id,
    fullName: p.fullName,
    phone: p.phone,
    fileNumber: p.fileNumber,
    lastVisit: p.lastVisit,
  }));

  return (
    <>
      <PageHead
        eyebrow={`${BRANCH.name} · walk-in`}
        title="Register a patient"
        sub="Four fields. Everything else can be added once they are in the chair."
      />
      <div style={{ maxWidth: 680 }}>
        <NewPatientForm existing={existing} />
      </div>
    </>
  );
}
