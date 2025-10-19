import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import * as sfn from "aws-cdk-lib/aws-stepfunctions";

export const invokeLambdaTaskWithPayload = (
  scope: Construct,
  lambdaFn: lambda.IFunction,
  description: string,
  payload: sfn.TaskInput,
  props?: Omit<tasks.LambdaInvokeProps, "lambdaFunction" | "payload">,
): tasks.LambdaInvoke => {
  return new tasks.LambdaInvoke(scope, description, {
    lambdaFunction: lambdaFn,
    payloadResponseOnly: props?.payloadResponseOnly ?? true,
    payload,
    ...props,
  });
};

export const invokeLambdaTask = (
  scope: Construct,
  lambda: lambda.IFunction,
  description: string,
  props?: Omit<tasks.LambdaInvokeProps, "lambdaFunction">,
): tasks.LambdaInvoke => {
  return new tasks.LambdaInvoke(scope, description, {
    lambdaFunction: lambda,
    payloadResponseOnly: true,
    ...props,
  });
};
