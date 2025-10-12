import { z } from "zod";

const JsonStringSchema = z.string();

const JsonTransformer = z.transform<string, Record<string, unknown>>(
  (input, ctx) => {
    try {
      return JSON.parse(input);
    } catch (e) {
      ctx.issues.push({
        code: "custom",
        message: "Not a valid JSON object",
        input,
      });
      return z.NEVER;
    }
  },
);

export const Json = {
  parse: (jsonString: string | undefined): object => {
    return JSON.parse(jsonString || "{}");
  },
  safeParse: <T extends z.ZodType<unknown, Record<string, unknown>>>(
    schema: T,
    jsonString: unknown,
  ): z.ZodSafeParseResult<z.output<T>> => {
    return JsonStringSchema.pipe(JsonTransformer)
      .pipe(schema)
      .safeParse(jsonString);
  },
};
