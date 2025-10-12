import { z, ZodType } from "zod";

export enum Environment {
  PROD = "prod",
  STAGING = "staging",
  TEST = "test",
  DEV = "dev",
  LOCAL = "local",
}

export const EnvironmentSchema: ZodType<Environment> = z.enum(Environment);

// Environment short code as AWS Resource Names have character limits
export enum EnvironmentAwsResourceName {
  PROD = "p",
  STAGING = "s",
  TEST = "t",
  DEV = "d",
  LOCAL = "l",
}

const environmentAwsResourceNameRecord: Record<
  Environment,
  EnvironmentAwsResourceName
> = {
  [Environment.PROD]: EnvironmentAwsResourceName.PROD,
  [Environment.STAGING]: EnvironmentAwsResourceName.STAGING,
  [Environment.TEST]: EnvironmentAwsResourceName.TEST,
  [Environment.DEV]: EnvironmentAwsResourceName.DEV,
  [Environment.LOCAL]: EnvironmentAwsResourceName.LOCAL,
};

export const Environments = {
  getAwsResourceName: (
    environment: Environment,
  ): EnvironmentAwsResourceName => {
    return environmentAwsResourceNameRecord[environment];
  },
};
