import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as iam from "aws-cdk-lib/aws-iam";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";

export interface TracedLambdaOptions {
  /**
   * The construct id for the Lambda function
   */
  id: string;

  /**
   * The function name for the Lambda function
   */
  functionName: string;

  /**
   * The entry path to the Lambda function code
   */
  entryPath: string;

  /**
   * Additional environment variables for the Lambda function
   */
  additionalEnvironment?: Record<string, string>;

  /**
   * Memory size in MB (default: 256)
   */
  memorySize?: number;

  /**
   * Timeout duration (default: 30 seconds)
   */
  timeout?: cdk.Duration;

  /**
   * Log retention period (default: ONE_WEEK)
   */
  logRetention?: logs.RetentionDays;

  /**
   * Enable X-Ray tracing (default: true)
   */
  enableTracing?: boolean;

  /**
   * Custom IAM role for the Lambda function
   */
  role?: iam.Role;
}

/**
 * Core function to create Lambda with all configuration options
 */
function createLambdaFunction(
  scope: Construct,
  options: TracedLambdaOptions,
): NodejsFunction {
  const {
    id,
    functionName,
    entryPath,
    additionalEnvironment = {},
    memorySize = 256,
    timeout = cdk.Duration.seconds(30),
    logRetention = logs.RetentionDays.ONE_WEEK,
    enableTracing = true,
    role,
  } = options;

  return new NodejsFunction(scope, id, {
    functionName,
    runtime: lambda.Runtime.NODEJS_LATEST,
    entry: entryPath,
    handler: "handler",
    timeout,
    memorySize,
    tracing: enableTracing ? lambda.Tracing.ACTIVE : lambda.Tracing.DISABLED,
    logRetention,
    role,
    environment: {
      NODE_OPTIONS: "--enable-source-maps",
      ...additionalEnvironment,
    },
    bundling: {
      externalModules: [], // Remove aws-sdk from external modules since it's not available in Node.js 22 runtime
      sourceMap: true,
      target: "node22",
      // Ensures esbuild >=0.22 bundles core Node dependencies instead of marking them external
      // which avoids Runtime.ImportModuleError: Cannot find module 'module'.
      esbuildArgs: {
        "--packages": "bundle",
      },
    },
  });
}

/**
 * Creates a Lambda function with X-Ray tracing enabled
 */
export function createTracedLambda(
  scope: Construct,
  options: TracedLambdaOptions,
): NodejsFunction {
  return createLambdaFunction(scope, {
    ...options,
    enableTracing: true,
  });
}

/**
 * Creates a Lambda function with basic execution role for CloudWatch Logs (no X-Ray tracing)
 */
export function createBasicLambda(
  scope: Construct,
  options: Omit<TracedLambdaOptions, "enableTracing">,
): NodejsFunction {
  // Create IAM role with AWS managed basic execution role if not provided
  const lambdaRole =
    options.role ||
    new iam.Role(scope, `${options.id}Role`, {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaBasicExecutionRole",
        ),
      ],
      description: `Lambda execution role for ${options.functionName}`,
    });

  return createLambdaFunction(scope, {
    ...options,
    enableTracing: false,
    role: lambdaRole,
  });
}
