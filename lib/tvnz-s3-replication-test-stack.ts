import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import { Construct } from "constructs";
import { createBasicLambda } from "./utils/lambda-utils";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as path from "path";
import { S3Service } from "../src/common/aws/services/s3-service";
import { AwsS3 } from "../src/common/aws/config-enum-declarations/aws-s3";
import * as datasync from "aws-cdk-lib/aws-datasync";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import { CfnResource } from "aws-cdk-lib"; // Correct import for escape hatch

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
    props: TvnzS3ReplicationTestStackProps
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
        }
      );

      this.replicationMonitorFunction = createBasicLambda(this, {
        id: "ReplicationMonitorFunction",
        functionName: "s3-replication-monitor",
        entryPath: path.join(
          __dirname,
          "../src/lambda/s3-replication-monitor/index.ts"
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

    // data sync
    // 2. Define the IAM Role for the S3 Location
    // This role allows DataSync to read/write to the sourceBucket.
    const datasyncRole = new iam.Role(this, "DataSyncS3ExecutionRole", {
      roleName: "tvnz-test-datasync-s3-execution-role",
      assumedBy: new iam.ServicePrincipal("datasync.amazonaws.com"),
      description:
        "IAM role for DataSync to read and write to the S3 destination bucket",
      inlinePolicies: {
        DataSyncS3Access: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: [
                "s3:ListBucket",
                "s3:ListObjectsV2",
                "s3:GetBucketLocation",
                "s3:ListBucketMultipartUploads",
              ],
              resources: [this.sourceBucket.bucketArn],
            }),
            new iam.PolicyStatement({
              actions: [
                "s3:GetObject",
                "s3:PutObject",
                "s3:DeleteObject",
                "s3:GetObjectVersion",
                "s3:ListMultipartUploadParts",
                "s3:AbortMultipartUpload",
              ],
              resources: [`${this.sourceBucket.bucketArn}/*`],
            }),
          ],
        }),
      },
    });

    // 3. Create the S3 Location (Destination)
    const s3Location = new datasync.CfnLocationS3(
      this,
      "S3DestinationLocation",
      {
        s3BucketArn: this.sourceBucket.bucketArn,
        s3Config: {
          bucketAccessRoleArn: datasyncRole.roleArn,
        },
        subdirectory: "gcp-sync-target/",
      }
    );

    const gcsLocation = new datasync.CfnLocationObjectStorage(
      this,
      "GCSLocation",
      {
        bucketName: "xingsoft-tvnz-tvbeat-dev",
        serverHostname: "storage.googleapis.com",
        serverProtocol: "HTTPS",
        serverPort: 443,
        accessKey: process.env.GCS_ACCESS_KEY,
        secretKey: process.env.GCS_SECRET_KEY,
        agentArns: ["placeholder"], // Temporary placeholder
      }
    );

    // Use escape hatch to remove agentArns for Enhanced mode
    gcsLocation.addPropertyDeletionOverride("AgentArns");

    // 5. Create the DataSync Task
    const dataSyncTask = new datasync.CfnTask(this, "GcpToAwsReplicationTask", {
      sourceLocationArn: gcsLocation.attrLocationArn,
      destinationLocationArn: s3Location.attrLocationArn,
      name: "Gcp-to-Aws-Replication",

      options: {
        verifyMode: "ONLY_FILES_TRANSFERRED",
        overwriteMode: "ALWAYS",
        transferMode: "CHANGED",
        preserveDeletedFiles: "PRESERVE",
        objectTags: "NONE",
      },
    });

    // Use escape hatch to set Enhanced mode
    dataSyncTask.addPropertyOverride("TaskMode", "ENHANCED");

    // Schedule DataSync task to run daily at 2 AM UTC
    // new events.Rule(this, "DataSyncScheduleRule", {
    //   schedule: events.Schedule.cron({
    //     minute: "0",
    //     hour: "2",
    //     day: "*",
    //     month: "*",
    //     year: "*",
    //   }),
    //   targets: [
    //     new targets.AwsApi({
    //       service: "datasync",
    //       action: "startTaskExecution",
    //       parameters: {
    //         TaskArn: dataSyncTask.attrTaskArn,
    //       },
    //     }),
    //   ],
    // });

    dataSyncTask.addDependency(s3Location);
    dataSyncTask.addDependency(gcsLocation);
  }
}
