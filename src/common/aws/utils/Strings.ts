import { remove } from "diacritics";
import { toArray } from "./Arrays";

const ALPHANUMERIC_REGEX_RANGE_WITHOUT_UNDERSCORE = "a-zA-Z0-9";
const ALPHANUMERIC_REGEX_RANGE_WITH_UNDERSCORE = `${ALPHANUMERIC_REGEX_RANGE_WITHOUT_UNDERSCORE}_`;

// Regex dealing with AWS String Tokens, eg: "${Token[id.77]}" AWS String Token is a placeholder generated for events.EventField.fromPath("$.id")
const AWS_TOKEN_REGEX_STRING_DOUBLE_ESCAPED = "\\$\\{Token\\[.*?\\]\\}";
const AWS_TOKEN_REGEX = new RegExp(
  `^${AWS_TOKEN_REGEX_STRING_DOUBLE_ESCAPED}$`,
  "i",
);
const AWS_TOKEN_REGEX_SPLIT_CAPTURE = new RegExp(
  `(${AWS_TOKEN_REGEX_STRING_DOUBLE_ESCAPED})`,
  "gi",
);

export type AlphanumericSanitizationOptions = {
  joiner?: string;
  replacer?: string;
  lowercase?: boolean;
  allowed?: string;
  noUnderscore?: boolean;
  awsTokens?: boolean;
};

export const sanitizeAlphanumeric = (
  unsanitized: string | string[],
  options?: AlphanumericSanitizationOptions,
): string => {
  const alphanumericRegexRange = options?.noUnderscore
    ? ALPHANUMERIC_REGEX_RANGE_WITHOUT_UNDERSCORE
    : ALPHANUMERIC_REGEX_RANGE_WITH_UNDERSCORE;
  const notAllowedRegex = new RegExp(
    `[^${alphanumericRegexRange}${options?.allowed || ""}]+`,
    "g",
  );

  const unsanitizedSegments: string[] = toArray(unsanitized);

  const noSpaceOrDiacriticSegments: string[] = unsanitizedSegments
    .map((segment) => remove(segment.trim()).split(/\s+/))
    .flat();

  const awsTokensIsolatedSegments: string[] = options?.awsTokens
    ? noSpaceOrDiacriticSegments
        .map((segment) => {
          const awsTokensIsolatedSubsegments = segment.split(
            AWS_TOKEN_REGEX_SPLIT_CAPTURE,
          );
          if (awsTokensIsolatedSubsegments[0] === "") {
            awsTokensIsolatedSubsegments.shift();
          }
          return awsTokensIsolatedSubsegments;
        })
        .flat()
    : noSpaceOrDiacriticSegments;

  const sanitizedSegments = awsTokensIsolatedSegments.map((segment) => {
    if (AWS_TOKEN_REGEX.test(segment)) {
      return segment;
    } else {
      const alphanumericAllowed = segment.replace(
        notAllowedRegex,
        options?.replacer || "",
      );
      return options?.lowercase
        ? alphanumericAllowed.toLowerCase()
        : alphanumericAllowed;
    }
  });

  const sanitized: string = sanitizedSegments.join(options?.joiner || "");
  return sanitized;
};

export const isString = (string: any): string is string => {
  return typeof string === "string";
};

/**
 * Return an S3 HTTPS URL using the bucket as a subdomain.
 * Encodes path segments and uses `AWS_REGION`.
 *
 * @param bucket S3 bucket name.
 * @param key    Object key (folders allowed).
 * @returns URL like https://<bucket>.s3.<region>.amazonaws.com/<encodedKey>
 */
export const s3ObjectUrl = (bucket: string, key: string): string => {
  const cleanKey = key.replace(/^\/+/, "");
  const encodedKey = cleanKey.split("/").map(encodeURIComponent).join("/");
  const host = `${bucket}.s3.${process.env.AWS_REGION}.amazonaws.com`;

  return `https://${host}/${encodedKey}`;
};
