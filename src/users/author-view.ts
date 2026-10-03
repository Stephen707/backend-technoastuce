import { Types } from 'mongoose';

// Public byline of a user (articles, comments). Never includes the email.
export const AUTHOR_PROJECTION = 'firstName lastName';

// A populated `author` read with AUTHOR_PROJECTION; null once the user is
// deleted.
export interface AuthorRecord {
  _id: Types.ObjectId;
  firstName?: string;
  lastName?: string;
}

export interface AuthorView {
  id: string;
  name: string | null;
}

export function toAuthorView(
  author: AuthorRecord | null | undefined,
): AuthorView | null {
  if (!author) return null;
  const name = [author.firstName, author.lastName]
    .filter(Boolean)
    .join(' ')
    .trim();
  return { id: author._id.toHexString(), name: name || null };
}
