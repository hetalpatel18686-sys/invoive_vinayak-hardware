import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PROTECTED = [
  '/dashboard',
  '/invoice',
  '/customers',
  '/items',
  '/stock',
  '/inventory',
  '/reports',
];

export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  const needsAuth = PROTECTED.some(p => path.startsWith(p));

  if (!needsAuth) return NextResponse.next();

  const hasSession =
    req.cookies.get('sb-access-token') ||
    req.cookies.get('supabase-auth-token') ||
    req.cookies.get('sb:token');

  if (!hasSession) {
    const login = req.nextUrl.clone();
    login.pathname = '/login';
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}
