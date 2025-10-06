#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { TracingTestStack } from "../lib/tracing-test-stack";

import { TvnzS3ReplicationTestStack } from "../lib/tvnz-s3-replication-test-stack";

const app = new cdk.App();

new TracingTestStack(app, "tvnz-s3-replication-test-target", {});

new TvnzS3ReplicationTestStack(app, "tvnz-s3-replication-test-stack", {
  env: { region: "ap-southeast-2" },
  sourceBucket: {
    bucketName: "tvnz-source-test-bucket", // Must contain 'test'
    prefix: "media/", // Optional: only replicate objects with this prefix
  },
  targetBucket: {
    bucketName: "tvnz-target-test-bucket", // Assumed to exist
    region: "ap-southeast-2", // Target region (required)
    accountId: "392804380399", // Target account ID (required, even if same)
  },
});
