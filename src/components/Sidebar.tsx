'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { signOutAction, switchBranchAction } from '@/app/actions/auth';

interface Props {
  userName: string;
  branches: { id: string; name: string; gstRegistered: boolean }[];
  activeBranchId: string;
  can: { patients: boolean; bill: boolean; dayClose: boolean; reports: boolean; gst: boolean };
}

export default function Sidebar({ userName, branches, activeBranchId, can }: Props) {
  const path = usePathname();
  const router = useRouter();
  const [pending, start] = useTransition();
  const link = (href: string, label: string) => {
    const active = href === '/' ? path === '/' : path.startsWith(href);
    return (
      <Link href={href} className={active ? 'active' : undefined} aria-current={active ? 'page' : undefined}>
        {label}
      </Link>
    );
  };

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          C
        </span>
        <span className="brand-name">Chairside</span>
      </div>

      <div className="branch-switch">
        <label className="lbl" htmlFor="branch-select">
          Branch
        </label>
        {branches.length > 1 ? (
          <select
            id="branch-select"
            value={activeBranchId}
            disabled={pending}
            onChange={(e) => {
              const v = e.target.value;
              start(async () => {
                await switchBranchAction(v);
                router.refresh();
              });
            }}
          >
            <option value="all">All branches (view only)</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        ) : (
          <div className="val">{branches[0]?.name}</div>
        )}
      </div>

      <nav className="main" aria-label="Main">
        {can.patients && activeBranchId !== 'all' ? (
          <Link href="/patients/new" className="newpt">
            <span aria-hidden="true">+</span> New patient
          </Link>
        ) : null}
        <div className="sec">Today</div>
        {link('/', 'Dashboard')}
        {can.dayClose ? link('/day-close', 'Day close') : null}
        {can.bill ? link('/unbilled', 'Unbilled') : null}
        {can.patients || can.bill ? <div className="sec">Practice</div> : null}
        {can.patients ? link('/patients', 'Patients') : null}
        {can.patients ? link('/invoices', 'Bills') : null}
        {can.patients || can.reports ? link('/receivables', 'Receivables') : null}
        {can.gst ? <div className="sec">Books</div> : null}
        {can.gst ? link('/gst', 'GST working papers') : null}
      </nav>

      <div className="sidebar-foot">
        <div className="who">{userName}</div>
        <form action={signOutAction}>
          <button type="submit" className="linkish">
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
