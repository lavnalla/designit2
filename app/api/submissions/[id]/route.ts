
import { getSubmission, normalizeEmail, updateSubmissionStatus } from '../../../../src/lib/storage';
import { isAdminRequest } from '../../../../src/lib/adminAuth';

// One design, to open it in the Studio: an approved one for anyone; one still in review (or not approved) only
// with the email it was submitted with (?email=), or for the admin
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const email = new URL(request.url).searchParams.get('email');
  try {
    const design = await getSubmission(id);
    const allowed =
      design &&
      (design.status === 'approved' ||
        (!!email && !!design.email && normalizeEmail(email) === design.email) ||
        isAdminRequest(request));
    if (!design || !allowed) return Response.json({ error: 'Design not found' }, { status: 404 });
    return Response.json({ id: design.id, name: design.name, imageData: design.imageData });
  } catch (error) {
    console.error('Loading submission failed:', error);
    return Response.json({ error: 'Could not load the design' }, { status: 500 });
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isAdminRequest(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;
  const body = await request.json();
  const { status } = body;
  
  if (status !== 'approved' && status !== 'rejected') {
    return Response.json({ error: 'Invalid status' }, { status: 400 });
  }
  
  let updatedSubmission;
  try {
    updatedSubmission = await updateSubmissionStatus(id, status);
  } catch (error) {
    console.error('Updating submission failed:', error);
    return Response.json({ error: 'Could not update the submission' }, { status: 500 });
  }
  
  if (!updatedSubmission) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }
  
  return Response.json(updatedSubmission);
}

