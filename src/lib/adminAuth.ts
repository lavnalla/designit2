// The admin password travels in the x-admin-password header. Headers can only carry Latin-1 characters, so it's
// sent URL-encoded (a password with any character, even one pasted with a curly quote or an invisible space,
// still gets through) and decoded again here.

// The header for a request made as the admin (in the browser)
export function adminHeaders(password: string): Record<string, string> {
  return { 'x-admin-password': encodeURIComponent(password) };
}

// Whether a request carries the admin password (on the server). Never, if no admin password is set.
export function isAdminRequest(request: Request): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  const sent = request.headers.get('x-admin-password');
  if (!expected || !sent) return false;
  let password = sent;
  try {
    password = decodeURIComponent(sent);
  } catch {
    // (Not encoded: taken as it is)
  }
  return password === expected;
}
