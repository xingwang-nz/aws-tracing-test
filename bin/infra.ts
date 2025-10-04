#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { TracingTestStack } from "../lib/tracing-test-stack";

const app = new cdk.App();
// new CdkStepFunctionsExampleStack(app, "CdkStepFunctionsExampleStack", {});
// new CdkStepFunctionsNativeCDKExampleStack(
//   app,
//   "CdkStepFunctionsNativeCDKExampleStack",
//   {},
// );
new TracingTestStack(app, "tracing-test-stack", {});
