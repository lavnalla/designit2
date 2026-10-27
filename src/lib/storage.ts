// Community submissions, stored in Supabase (the `submissions` table: see db_schema.sql). Talks to Supabase's
// REST API from the server with the service role key, so it's never sent to the browser and row level
// security doesn't get in the way of the admin. Without Supabase configured nothing is stored: listing returns
// no submissions and saving fails with StorageUnavailableError.

export interface Submission {
  id: string;
  name: string;
  author: string;
  // Who submitted it (their "My designs" list is everything submitted with this email). Left out of what the
  // public community gallery gets.
  email?: string;
  imageData: string; // a data URL
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

// Thrown when saving is attempted without a database, so API routes can tell it apart from real errors
export class StorageUnavailableError extends Error {
  constructor() {
    super('Submissions are unavailable: no database is connected.');
    this.name = 'StorageUnavailableError';
  }
}

type Row = {
  id: string;
  name: string;
  author: string;
  email?: string | null;
  image_data: string;
  status: Submission['status'];
  created_at: string;
};

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function configured() {
  return !!SUPABASE_URL && !!SERVICE_KEY;
}

// A request to the submissions table (path: the query after the table name)
async function table(path: string, init: RequestInit = {}): Promise<Row[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/submissions${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY!,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...init.headers,
    },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Supabase ${init.method ?? 'GET'} failed (${res.status}): ${await res.text()}`);
  return res.status === 204 ? [] : res.json();
}

function fromRow(row: Row, withEmail: boolean): Submission {
  return {
    id: row.id,
    name: row.name,
    author: row.author,
    ...(withEmail && row.email ? { email: row.email } : {}),
    imageData: row.image_data,
    status: row.status,
    createdAt: row.created_at,
  };
}

// Emails are compared as lower case, trimmed
export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

// All submissions for the admin (with who sent them), else just the approved ones (without)
export async function getSubmissions(admin: boolean = false): Promise<Submission[]> {
  if (!configured()) return [];
  const rows = await table(
    admin
      ? '?select=*&order=created_at.desc'
      : '?select=id,name,author,image_data,status,created_at&status=eq.approved&order=created_at.desc',
  );
  return rows.map((row) => fromRow(row, admin));
}

// Everything submitted with this email, whatever its status (the submitter's "My designs")
export async function getSubmissionsByEmail(email: string): Promise<Submission[]> {
  if (!configured()) return [];
  const rows = await table(
    `?select=*&email=eq.${encodeURIComponent(normalizeEmail(email))}&order=created_at.desc`,
  );
  return rows.map((row) => fromRow(row, true));
}

// One submission by its id (null if there's none)
export async function getSubmission(id: string): Promise<Submission | null> {
  if (!configured()) return null;
  const rows = await table(`?select=*&id=eq.${encodeURIComponent(id)}&limit=1`);
  return rows[0] ? fromRow(rows[0], true) : null;
}

export async function saveSubmission(
  submission: Omit<Submission, 'id' | 'status' | 'createdAt'> & { email: string },
): Promise<Submission> {
  if (!configured()) throw new StorageUnavailableError();
  const [row] = await table('', {
    method: 'POST',
    body: JSON.stringify({
      name: submission.name,
      author: submission.author,
      email: normalizeEmail(submission.email),
      image_data: submission.imageData,
      status: 'pending',
    }),
  });
  return fromRow(row, true);
}

export async function updateSubmissionStatus(
  id: string,
  status: 'approved' | 'rejected',
): Promise<Submission | null> {
  if (!configured()) return null;
  const rows = await table(`?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
  return rows[0] ? fromRow(rows[0], true) : null;
}

export async function getApprovedSubmissions(): Promise<Submission[]> {
  return getSubmissions(false);
}
