import type { Metadata } from 'next';
import './globals.css';
import { BRANCH, UNBILLED_TODAY } from '@/lib/seed';

export const metadata: Metadata = {
  title: 'Chairside',
  description: 'Clinic operating system for Indian dental practices',
};

function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">C</span>
        <span className="brand-name">Chairside</span>
      </div>

      <div className="branch-switch">
        <div className="lbl">Branch</div>
        <div className="val">
          {BRANCH.name} <span className="pill tax12">GST</span>
        </div>
      </div>

      <nav className="main">
        <div className="sec">Today</div>
        <a href="/">Dashboard</a>
        <a href="/day-close">
          Day close <span className="count">open</span>
        </a>
        <a href="/unbilled">
          Unbilled <span className="count">{UNBILLED_TODAY.length}</span>
        </a>

        <div className="sec">Practice</div>
        <a href="/patients">Patients</a>
        <a href="/invoices">Invoices</a>
        <a href="/receivables">Receivables</a>

        <div className="sec">Books</div>
        <a href="/gst">GST working papers</a>
      </nav>

      <div style={{ marginTop: 'auto', padding: '0 10px', fontSize: 11, color: 'var(--ink-3)' }}>
        Phase 0 · dev seed
        <br />
        No database required
      </div>
    </aside>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <Sidebar />
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
