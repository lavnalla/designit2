import {
  saveSubmission,
  getSubmissions,
  getSubmissionsByEmail,
  StorageUnavailableError,
} from '../../../src/lib/storage';
import { isAdminRequest } from '../../../src/lib/adminAuth';

// A plausible email address (something@something.something)
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// The largest design image accepted (a data URL, in characters)
const MAX_IMAGE_LENGTH = 8_000_000;

// ?admin=true (with the admin password in x-admin-password): every submission, with who sent it.
// ?email=...: everything submitted with that email, whatever its status (the submitter's "My designs").
// Otherwise: the approved designs, for the community gallery.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  try {
    if (searchParams.get('admin') === 'true') {
      if (!isAdminRequest(request)) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }
      return Response.json(await getSubmissions(true));
    }

    const email = searchParams.get('email');
    if (email !== null) {
      if (!EMAIL.test(email.trim())) return Response.json({ error: 'Enter a valid email address' }, { status: 400 });
      return Response.json(await getSubmissionsByEmail(email));
    }

    return Response.json(await getSubmissions(false));
  } catch (error) {
    console.error('Listing submissions failed:', error);
    return Response.json({ error: 'Could not load submissions' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const author = typeof body.author === 'string' ? body.author.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const imageData = typeof body.imageData === 'string' ? body.imageData : '';

    if (!name || !author || !email || !imageData) {
      return Response.json({ error: 'Please fill in the design name, your name and your email.' }, { status: 400 });
    }
    if (!EMAIL.test(email)) {
      return Response.json({ error: 'Enter a valid email address.' }, { status: 400 });
    }
    if (!imageData.startsWith('data:image/') || imageData.length > MAX_IMAGE_LENGTH) {
      return Response.json({ error: 'The design image is missing or too large.' }, { status: 400 });
    }

    const saved = await saveSubmission({ name, author, email, imageData });
    return Response.json(saved);
  } catch (error) {
    if (error instanceof StorageUnavailableError) {
      // No database is connected: say so instead of a generic server error
      return Response.json({ error: error.message }, { status: 503 });
    }
    console.error('Submission error:', error);
    return Response.json({ error: 'Could not save the design. Please try again.' }, { status: 500 });
  }
}
