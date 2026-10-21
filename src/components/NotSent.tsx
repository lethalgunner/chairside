/** The network-failure message from useActionForm (T23). Renders nothing when there is none. */
export default function NotSent({ message }: { message: string | null }) {
  return message ? (
    <div className="callout warn" role="alert">
      {message}
    </div>
  ) : null;
}
