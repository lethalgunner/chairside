import { NextResponse, type NextRequest } from 'next/server';

/**
 * First line of defence: no session cookie, no app. This only checks the
 * cookie exists; every page and server action still validates the session
 * against the database through requireContext().
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === '/login' || pathname === '/setup' || pathname === '/api/health') return NextResponse.next();
  if (!req.cookies.get('cs_session')) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
