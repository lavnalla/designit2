// NOTE: Make sure to check the import path relative to where this file is
import { saveSubmission, getSubmissions, StorageUnavailableError } from '../../../src/lib/storage';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const adminRequest = searchParams.get('admin') === 'true';
  const password = request.headers.get('x-admin-password');
  
  // Debug log
  console.log('[API] Admin check - Request:', adminRequest, 'Password Provided:', !!password, 'Match:', password === process.env.ADMIN_PASSWORD);
  
  // Verify password if requesting admin data
  const isAdmin = adminRequest && password === process.env.ADMIN_PASSWORD;
  
  console.log('[API] Admin request?', adminRequest, 'Pass match?', password === process.env.ADMIN_PASSWORD);
  console.log('[API] Fetching submissions with admin flag:', isAdmin);

  const submissions = await getSubmissions(isAdmin);
  console.log('[API] Found submissions:', submissions.length);
  
  return Response.json(submissions);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, author, imageData } = body;
    
    if (!name || !author || !imageData) {
      console.warn('[API] Missing fields in submission:', { name, author, hasImage: !!imageData });
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }
    
    console.log('[API] Saving new submission:', { name, author });

    const newSubmission = await saveSubmission({
      name,
      author,
      imageData
    });
    
    console.log('[API] Saved successfully:', newSubmission.id);
    return Response.json(newSubmission);
  } catch (error) {
    if (error instanceof StorageUnavailableError) {
      // No database is connected: say so instead of a generic server error
      return Response.json({ error: error.message }, { status: 503 });
    }
    console.error('Submission error:', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
