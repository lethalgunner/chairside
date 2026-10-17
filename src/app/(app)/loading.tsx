export default function Loading() {
  return (
    <div className="state-block" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" /> Loading…
    </div>
  );
}
