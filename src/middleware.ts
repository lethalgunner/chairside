import { NextResponse, type NextRequest } from 'next/server';
import { loginHref, PATH_HEADER } from '@/lib/nav/safe-next';

/**
 * First line of defence: no session cookie, no app. This only checks the
 * cookie exists; every page and server action still validates the session
 * against the database through requireContext()/getContext().
 *
 * Server-action POSTs are let through even without a cookie: every action
 * checks the session itself and answers "signed out" in a shape the form
 * understands, so the desk is sent to sign in and brought back to the page
 * (T29, QA Q13) instead of the form failing as if the network had dropped.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === '/login' || pathname === '/setup' || pathname === '/api/health') return NextResponse.next();
  const search = new URLSearchParams(req.nextUrl.search);
  search.delete('_rsc');
  const qs = search.toString();
  const path = qs ? `${pathname}?${qs}` : pathname;
  const isAction = req.method === 'POST' && req.headers.has('next-action');
  if (!req.cookies.get('cs_session') && !isAction) {
    // Never signed in here (or signed out on purpose): no "signed out" message.
    return NextResponse.redirect(new URL(loginHref(path, false), req.url));
  }
  const headers = new Headers(req.headers);
  headers.set(PATH_HEADER, path);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
