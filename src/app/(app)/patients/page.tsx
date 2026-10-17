import Link from 'next/link';
import { requireContext } from '@/lib/auth';
import { formatIndianMobile } from '@/domain/phone';
import { searchPatients } from '@/services/patients';
import { Card, Empty, PageHead } from '@/components/ui';

export default async function PatientsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requireContext();
  const { q = '' } = await searchParams;
  const results = await searchPatients(ctx, q, 50);
  const canCreate = ctx.activeBranchId !== 'all';

  return (
    <>
      <PageHead
        title="Patients"
        sub={q ? `Results for “${q}”` : 'Most recently registered'}
        right={canCreate ? <Link className="cta" href={`/patients/new${q ? `?q=${encodeURIComponent(q)}` : ''}`}>New patient</Link> : null}
      />
      <form className="search-row" role="search" action="/patients">
        <label htmlFor="q" className="sr-only">
          Search patients
        </label>
        <input id="q" name="q" type="search" defaultValue={q} placeholder="Name, phone (any 3+ digits) or file number" autoFocus />
        <button className="primary" type="submit">
          Search
        </button>
      </form>
      <Card title={`${results.length} patient${results.length === 1 ? '' : 's'}`} flush>
        {results.length === 0 ? (
          <Empty action={canCreate ? { href: `/patients/new${q ? `?q=${encodeURIComponent(q)}` : ''}`, label: 'Register a new patient' } : undefined}>
            {q ? 'No patient matches that. Check the spelling or try the last digits of their phone.' : 'No patients yet.'}
          </Empty>
        ) : (
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Patient</th>
                  <th scope="col">Phone</th>
                  <th scope="col">File no.</th>
                  <th scope="col" className="num">Age</th>
                </tr>
              </thead>
              <tbody>
                {results.map((p) => (
                  <tr key={p.id}>
                    <td className="strong">
                      <Link className="link" href={`/patients/${p.id}`}>
                        {p.fullName}
                      </Link>
                    </td>
                    <td className="mono">{formatIndianMobile(p.phone)}</td>
                    <td className="mono">{p.fileNumbers.join(', ') || '—'}</td>
                    <td className="num">{p.age ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
