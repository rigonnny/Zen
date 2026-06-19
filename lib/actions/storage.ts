"use server";

import { createClient } from "@/lib/supabase/server";

/**
 * Create a short-lived signed URL for a private storage object.
 * Pass `downloadName` to force a download with that filename.
 */
export async function createSignedUrlAction(
  bucket: string,
  path: string,
  downloadName?: string
): Promise<string | null> {
  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, 60 * 5, downloadName ? { download: downloadName } : undefined);

  if (error || !data) return null;
  return data.signedUrl;
}

/** Remove an object from a bucket (used when deleting a document/offer). */
export async function removeFileAction(
  bucket: string,
  path: string
): Promise<{ error?: string }> {
  const supabase = createClient();
  const { error } = await supabase.storage.from(bucket).remove([path]);
  return error ? { error: error.message } : {};
}
