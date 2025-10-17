import * as cdk from "aws-cdk-lib";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as path from "path";
import { createBasicLambda } from "./utils/lambda-utils";

export interface S3ReplicationMonitorStackProps extends cdk.StackProps {
  logGroupPrefix?: string;
}

export class S3ReplicationMonitorStack extends cdk.Stack {
  public readonly replicationLogGroup: logs.LogGroup;
  public readonly replicationMonitorFunction: NodejsFunction;

  constructor(
    scope: Construct,
    id: string,
    props?: S3ReplicationMonitorStackProps,
  ) {
    super(scope, id, props);

    const lgName = `/aws/s3/tvnz-replication-monitor`;

    this.replicationLogGroup = new logs.LogGroup(
      this,
      "ReplicationMonitorLogGroup",
      {
        logGroupName: `${lgName}`,
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      },
    );

    this.replicationMonitorFunction = createBasicLambda(this, {
      id: "TvnzReplicationMonitorFunction",
      functionName: "tvnz-s3-replication-monitor",
      entryPath: path.join(
        __dirname,
        "../src/lambda/s3-replication-monitor/index.ts",
      ),
      timeout: cdk.Duration.seconds(60),
      additionalEnvironment: {
        LOG_GROUP_NAME: this.replicationLogGroup.logGroupName,
      },
    });
  }
}
