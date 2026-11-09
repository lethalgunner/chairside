import { formatINR, type Paise } from '@/domain/money';

/** "₹6,000 due" beside a patient's name (Sprint 8): the desk sees it at booking and arrival. */
export default function DueBadge({ due }: { due: Paise | undefined }) {
  if (!due || due <= 0) return null;
  return <span className="pill due">{formatINR(due, { paise: due % 100 !== 0 })} due</span>;
}
