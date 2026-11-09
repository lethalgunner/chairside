import Link from 'next/link';
import { requireContext } from '@/lib/auth';
import { displayDate } from '@/domain/dates';
import { HELP_TOPICS, WHATS_NEW } from '@/domain/help';
import { Card, PageHead } from '@/components/ui';

/** Help and What's new (Sprint 9). */
export default async function HelpPage() {
  await requireContext();
  return (
    <>
      <PageHead title="Help" sub="Short answers to everyday questions. Stuck on something else? Ask the owner, or write to Chairside support." />
      <nav aria-label="Help topics" className="help-toc">
        <ul className="plain">
          {HELP_TOPICS.map((t) => (
            <li key={t.id}><a className="link" href={`#${t.id}`}>{t.title}</a></li>
          ))}
          <li><a className="link" href="#whats-new">What’s new</a></li>
        </ul>
      </nav>
      {HELP_TOPICS.map((t) => (
        <section key={t.id} id={t.id} className="card help-topic" aria-labelledby={`h-${t.id}`}>
          <header><h2 id={`h-${t.id}`}>{t.title}</h2>{t.href ? <Link className="link" href={t.href}>{t.linkText} →</Link> : null}</header>
          <div className="body">
            <ol>
              {t.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          </div>
        </section>
      ))}
      <div id="whats-new">
        <Card title="What’s new">
          {WHATS_NEW.map((r) => (
            <div key={r.id} className="release">
              <h3>{displayDate(r.date)}</h3>
              <ul>
                {r.items.map((it, i) => (
                  <li key={i}>{it}</li>
                ))}
              </ul>
            </div>
          ))}
        </Card>
      </div>
    </>
  );
}
