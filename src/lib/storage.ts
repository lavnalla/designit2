// Community submissions storage. No database is connected right now (the Supabase project was removed),
// so nothing is stored: listing returns no submissions, saving fails with a clear error, and status
// updates find nothing. The functions and the Submission shape are kept so a database can be plugged
// back in here without touching the pages and API routes that use them (see db_schema.sql for the table).

export interface Submission {
  id: string;
  name: string;
  author: string;
  imageData: string; // base64
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

export async function getSubmissions(admin: boolean = false): Promise<Submission[]> {
  void admin; // no database: there are no submissions to list, approved or otherwise
  return [];
}

export async function saveSubmission(
  submission: Omit<Submission, 'id' | 'status' | 'createdAt'>,
): Promise<Submission> {
  void submission;
  throw new StorageUnavailableError();
}

export async function updateSubmissionStatus(
  id: string,
  status: 'approved' | 'rejected',
): Promise<Submission | null> {
  void id;
  void status;
  return null; // no database: there's no submission to update
}

export async function getApprovedSubmissions(): Promise<Submission[]> {
  return getSubmissions(false);
}
