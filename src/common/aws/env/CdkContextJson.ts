import { z } from "zod";
import { EnvironmentSchema } from "./Environment";
import { AuthorSchema } from "./Author";

export const CdkContextJsonSchema = z.object({
  environment: EnvironmentSchema,
  author: AuthorSchema,
});

export type CdkContextJson = z.infer<typeof CdkContextJsonSchema>;
