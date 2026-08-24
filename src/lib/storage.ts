import { supabase } from './db';

export interface Submission {
  id: string;
  name: string;
  author: string;
  imageData: string; // base64
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

function formatStorageError(error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
    };
  }

  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    return {
      message: record.message ?? 'Unknown storage error',
      details: record.details ?? null,
      hint: record.hint ?? null,
      code: record.code ?? null,
    };
  }

  return { message: String(error) };
}

export async function getSubmissions(admin: boolean = false): Promise<Submission[]> {
  try {
    let query = supabase
      .from('submissions')
      .select('*')
      .order('created_at', { ascending: false });

    if (!admin) {
      query = query.eq('status', 'approved');
    }

    const { data, error } = await query;
    
    if (error) {
      console.warn('[Storage] Unable to fetch submissions. Falling back to empty list.', formatStorageError(error));
      return [];
    }

    console.log(`[Storage] Fetched ${data?.length} submissions. Admin mode: ${admin}`);
    if (admin && data && data.length === 0) {
       // Debug: check count without any filters
       const { count } = await supabase.from('submissions').select('*', { count: 'exact', head: true });
       console.log(`[Storage] Total rows in DB (raw count): ${count}`);
    }

    return (data as any[]).map(row => ({
      id: row.id,
      name: row.name,
      author: row.author,
      imageData: row.image_data,
      status: row.status,
      createdAt: row.created_at,
    }));
  } catch (error) {
    console.warn('[Storage] Unexpected failure fetching submissions. Falling back to empty list.', formatStorageError(error));
    return [];
  }
}

export async function saveSubmission(submission: Omit<Submission, 'id' | 'status' | 'createdAt'>): Promise<Submission> {
  const status = 'pending';
  
  try {
    const { data, error } = await supabase
      .from('submissions')
      .insert([
        { 
            name: submission.name, 
            author: submission.author, 
            image_data: submission.imageData, 
            status: status
        }
      ])
      .select()
      .single();

    if (error) {
      console.error('Error saving submission to Supabase:', error);
      throw error;
    }

    return {
      id: data.id,
      name: data.name,
      author: data.author,
      imageData: data.image_data,
      status: data.status,
      createdAt: data.created_at,
    };
  } catch (error) {
    console.error('Unexpected error saving submission:', error);
    throw error;
  }
}

export async function updateSubmissionStatus(id: string, status: 'approved' | 'rejected'): Promise<Submission | null> {
  try {
    const { data, error } = await supabase
      .from('submissions')
      .update({ status: status })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating submission status:', error);
      return null;
    }
    
    return {
      id: data.id,
      name: data.name,
      author: data.author,
      imageData: data.image_data,
      status: data.status,
      createdAt: data.created_at,
    };
  } catch (error) {
    console.error('Unexpected error updating submission status:', error);
    return null;
  }
}

export async function getApprovedSubmissions(): Promise<Submission[]> {
  return getSubmissions(false);
}

