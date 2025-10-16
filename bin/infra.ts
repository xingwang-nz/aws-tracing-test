#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { TracingTestStack } from "../lib/tracing-test-stack";

import { TvnzS3ReplicationTestStack } from "../lib/tvnz-s3-replication-test-stack";
import {
  TEST_REPLICATION_SOURCE_BUCKET_2_NAME,
  TEST_REPLICATION_SOURCE_BUCKET_NAME,
} from "./app-config";

const app = new cdk.App();

// Create a dedicated stack that owns the replication monitor Lambda so it
// can be shared by multiple replication stacks.
import { S3ReplicationMonitorStack } from "../lib/s3-replication-monitor-stack";
import { TracingTestStack2 } from "../lib/tracing-test-stack-2";

new TracingTestStack(app, "tracing-test-stack");

new TracingTestStack2(app, "tracing-test-stack-2");

const monitorStack = new S3ReplicationMonitorStack(
  app,
  "tvnz-s3-replication-monitor-stack",
  {
    env: { region: "ap-southeast-2" },
  },
);

new TvnzS3ReplicationTestStack(app, "tvnz-s3-replication-test-stack", {
  env: { region: "ap-southeast-2" },
  sourceBucket: {
    bucketName: TEST_REPLICATION_SOURCE_BUCKET_NAME, // Assumed to exist
    prefix: "media/", // Optional: only replicate objects with this prefix
  },
  targetBucket: {
    bucketName: "tvnz-target-test-bucket",
    region: "ap-southeast-2", // Target region (required)
    accountId: "392804380399", // Target account ID (required, even if same)
  },
  monitorLambda: monitorStack.replicationMonitorFunction,
}).addDependency(monitorStack);

new TvnzS3ReplicationTestStack(app, "tvnz-s3-replication-test-stack-2", {
  env: { region: "ap-southeast-2" },
  sourceBucket: {
    bucketName: TEST_REPLICATION_SOURCE_BUCKET_2_NAME,
    prefix: "media/", // Optional: only replicate objects with this prefix
  },
  targetBucket: {
    bucketName: "tvnz-target-test-bucket", // Assumed to exist
    region: "ap-southeast-2", // Target region (required)
    accountId: "392804380399", // Target account ID (required, even if same)
  },
  monitorLambda: monitorStack.replicationMonitorFunction,
}).addDependency(monitorStack);
