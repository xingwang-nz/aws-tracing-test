import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import { Construct } from "constructs";
import { createBasicLambda } from "./lambda-utils";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as path from "path";
import { S3Service } from "../src/common/aws/services/s3-service";
import { AwsS3 } from "../src/common/aws/config-enum-declarations/aws-s3";

export interface TvnzS3ReplicationTestStackProps extends cdk.StackProps {
  /**
   * Source bucket configuration (must contain 'test' in name)
   */
  sourceBucket: {
    bucketName: string;
    prefix?: string; // Source prefix to replicate from (optional)
  };

  /**
   * Target bucket configuration (assumed to exist, treated as cross-account)
   */
  targetBucket: {
    bucketName: string;
    prefix?: string; // Target prefix to replicate to (optional)
    region: string; // Target region (required)
    accountId: string; // Target account ID (required, even if same account)
  };

  /**
   * Replication configuration (optional)
   */
  replication?: {
    // Basic replication configuration - using simplified schema for compatibility
  };

  /** Optional: reuse an existing replication monitor lambda created in another stack */
  monitorLambda?: NodejsFunction;
}

export class TvnzS3ReplicationTestStack extends cdk.Stack {
  public readonly sourceBucket: s3.Bucket;
  public readonly replicationRole: iam.Role;
  public readonly targetBucketName: string;
  public replicationLogGroup: logs.LogGroup;
  public replicationMonitorFunction: NodejsFunction;

  constructor(
    scope: Construct,
    id: string,
    props: TvnzS3ReplicationTestStackProps,
  ) {
    super(scope, id, props);

    const {
      sourceBucket: sourceBucketConfig,
      targetBucket: targetBucketConfig,
    } = props;

    // Validate source bucket name contains 'test'
    if (!sourceBucketConfig.bucketName.toLowerCase().includes("test")) {
      throw new Error('Source bucket name must contain "test" wording');
    }

    this.targetBucketName = targetBucketConfig.bucketName;

    // Create source S3 bucket (with 'test' in name) using SSE-S3 encryption
    this.sourceBucket = new s3.Bucket(this, "SourceBucket", {
      bucketName: sourceBucketConfig.bucketName,
      versioned: true, // Required for replication
      encryption: s3.BucketEncryption.S3_MANAGED, // Use SSE-S3 encryption
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Use RETAIN for production
      autoDeleteObjects: true, // Use false for production
    });

    // Allow a monitor lambda to be passed in (so it can be created once and reused).
    if (props.monitorLambda) {
      this.replicationMonitorFunction = props.monitorLambda;
    } else {
      // create a local monitor lambda when none is provided
      this.replicationLogGroup = new logs.LogGroup(
        this,
        "ReplicationMonitorLogGroup",
        {
          logGroupName: `/aws/s3/replication-monitor/${this.sourceBucket.bucketName}-replication-monitor`,
          retention: logs.RetentionDays.TWO_WEEKS,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        },
      );

      this.replicationMonitorFunction = createBasicLambda(this, {
        id: "ReplicationMonitorFunction",
        functionName: "s3-replication-monitor",
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

    S3Service.cdk.configureReplication({
      stack: this,
      sourceBucket: this.sourceBucket,
      sourceBucketResource: AwsS3.TVBEAT_FILES,
      monitorLambda: this.replicationMonitorFunction,
      replicationRules: [
        {
          id: "ReplicateToTvBeat",
          destinationBucketArn: `arn:aws:s3:::${targetBucketConfig.bucketName}`,
          destinationAccountId: targetBucketConfig.accountId,
          prefix: sourceBucketConfig.prefix,
          priority: 1,
        },
      ],
    });

    /////////////////////////////////////////////
    // const replicationRole = this.createReplicationRole(targetBucketConfig);

    // Configure S3 replication with RTC and metrics enabled
    // const replicationConfig: s3.CfnBucket.ReplicationConfigurationProperty = {
    //   role: replicationRole.roleArn,
    //   rules: [
    //     {
    //       id: "ReplicateToTvBeat",
    //       status: "Enabled",
    //       priority: 1,
    //       filter: {
    //         prefix: sourceBucketConfig.prefix,
    //       },
    //       destination: {
    //         bucket: `arn:aws:s3:::${this.targetBucketName}`,
    //         accessControlTranslation: {
    //           owner: "Destination",
    //         },
    //         account: targetBucketConfig.accountId,
    //         replicationTime: {
    //           status: "Enabled",
    //           time: {
    //             minutes: 15, // Objects should replicate within 15 minutes
    //           },
    //         },
    //         // Enable metrics for replication monitoring with event threshold
    //         metrics: {
    //           status: "Enabled",
    //           // IMPORTANT: eventThreshold must be provided and match RTC threshold if RTC is enabled
    //           eventThreshold: {
    //             minutes: 15,
    //           },
    //         },
    //       },
    //       deleteMarkerReplication: {
    //         status: "Enabled",
    //       },
    //     },
    //   ],
    // };

    // Add replication configuration to the bucket
    // const cfnBucket = this.sourceBucket.node.defaultChild as s3.CfnBucket;
    // cfnBucket.replicationConfiguration = replicationConfig;

    // Create replication failure monitoring
    // this.createReplicationFailureMonitoring();
  }

  private createReplicationRole(
    targetBucketConfig: TvnzS3ReplicationTestStackProps["targetBucket"],
  ): iam.Role {
    const role = new iam.Role(this, "ReplicationRole", {
      assumedBy: new iam.ServicePrincipal("s3.amazonaws.com"),
      description: "IAM role for S3 cross-account replication",
    });

    // Source bucket permissions
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: "SourceBucketPermissions",
        effect: iam.Effect.ALLOW,
        actions: [
          "s3:GetReplicationConfiguration",
          "s3:ListBucket",
          "s3:GetBucketVersioning",
        ],
        resources: [this.sourceBucket.bucketArn],
      }),
    );

    // Source bucket object permissions
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: "SourceBucketObjectPermissions",
        effect: iam.Effect.ALLOW,
        actions: [
          "s3:GetObjectVersion",
          "s3:GetObjectVersionAcl",
          "s3:GetObjectVersionForReplication",
          "s3:GetObjectVersionTagging",
          "s3:GetObjectRetention",
          "s3:GetObjectLegalHold",
        ],
        resources: [`${this.sourceBucket.bucketArn}/*`],
      }),
    );

    // Target bucket permissions
    const targetBucketArn = `arn:aws:s3:::${targetBucketConfig.bucketName}`;
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: "DestinationWritePermissions",
        effect: iam.Effect.ALLOW,
        actions: [
          "s3:ReplicateObject",
          "s3:ReplicateDelete",
          "s3:ReplicateTags",
        ],
        resources: [`${targetBucketArn}/*`],
      }),
    );

    role.addToPolicy(
      new iam.PolicyStatement({
        sid: "MetricsPermissions",
        effect: iam.Effect.ALLOW,
        actions: ["cloudwatch:PutMetricData"],
        resources: ["*"],
        conditions: {
          StringEquals: {
            "cloudwatch:namespace": "AWS/S3",
          },
        },
      }),
    );

    return role;
  }

  private createReplicationFailureMonitoring(): void {
    // Create CloudWatch Log Group for replication monitoring
    this.replicationLogGroup = new logs.LogGroup(
      this,
      "ReplicationMonitorLogGroup",
      {
        logGroupName: `/aws/s3/replication-monitor/${this.sourceBucket.bucketName}`,
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      },
    );

    // Create Lambda function for replication failure monitoring using utility
    this.replicationMonitorFunction = createBasicLambda(this, {
      id: "ReplicationMonitorFunction",
      functionName: "s3-replication-monitor",
      entryPath: path.join(
        __dirname,
        "../src/lambda/s3-replication-monitor/index.ts",
      ),
      timeout: cdk.Duration.seconds(60),
      additionalEnvironment: {
        LOG_GROUP_NAME: this.replicationLogGroup.logGroupName,
      },
    });

    // Add S3 bucket notifications for replication events with meaningful construct names
    // These events are triggered when replication fails or has issues

    // Replication failure events - critical alerts
    this.sourceBucket.addEventNotification(
      s3.EventType.REPLICATION_OPERATION_FAILED_REPLICATION,
      new s3n.LambdaDestination(this.replicationMonitorFunction),
    );

    // Replication threshold events - timing alerts
    this.sourceBucket.addEventNotification(
      s3.EventType.REPLICATION_OPERATION_MISSED_THRESHOLD,
      new s3n.LambdaDestination(this.replicationMonitorFunction),
    );

    // Replication recovery events - eventual success
    this.sourceBucket.addEventNotification(
      s3.EventType.REPLICATION_OPERATION_REPLICATED_AFTER_THRESHOLD,
      new s3n.LambdaDestination(this.replicationMonitorFunction),
    );

    // Replication tracking events - monitoring gaps
    this.sourceBucket.addEventNotification(
      s3.EventType.REPLICATION_OPERATION_NOT_TRACKED,
      new s3n.LambdaDestination(this.replicationMonitorFunction),
    );
  }
}
