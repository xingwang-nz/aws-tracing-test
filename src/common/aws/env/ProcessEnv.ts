import { Json } from "../utils/Json";
import { CdkContextJsonSchema } from "./CdkContextJson";
import { CdkContextJson } from "./CdkContextJson";

export enum ProcessEnv {
  AWS_ENDPOINT_URL = "AWS_ENDPOINT_URL",
  CDK_CONTEXT_JSON = "CDK_CONTEXT_JSON",
}

export const ProcessEnvs: ProcessEnvsType = {
  [ProcessEnv.AWS_ENDPOINT_URL]: () => {
    return processEnvGet(ProcessEnv.AWS_ENDPOINT_URL);
  },
  [ProcessEnv.CDK_CONTEXT_JSON]: () => {
    return CdkContextJsonSchema.parse(
      Json.parse(processEnvGet(ProcessEnv.CDK_CONTEXT_JSON)),
    );
  },
} as const;

interface ProcessEnvsType {
  CDK_CONTEXT_JSON: () => CdkContextJson;
  AWS_ENDPOINT_URL: () => string | undefined;
}

const processEnvGet = (processEnv: ProcessEnv) => process.env[processEnv];
