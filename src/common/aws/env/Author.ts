import { z } from "zod";
import { sanitizeAlphanumeric } from "../utils/Strings";

export const AuthorSchema = z
  .string()
  .optional()
  .transform((author) => Authors.sanitize(author, { limit: 5 }));

export const Authors = {
  sanitize: (
    author: string | undefined,
    options?: { limit?: number },
  ): string | undefined => {
    if (!author) {
      return undefined;
    }
    const sanitized = sanitizeAlphanumeric(author, { lowercase: true });
    return options?.limit ? sanitized.slice(0, options.limit) : sanitized;
  },
};
