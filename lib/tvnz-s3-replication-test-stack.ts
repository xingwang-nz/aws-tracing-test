import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

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
}

export class TvnzS3ReplicationTestStack extends cdk.Stack {
  public readonly sourceBucket: s3.Bucket;
  public readonly replicationRole: iam.Role;
  public readonly targetBucketName: string;

  constructor(
    scope: Construct,
    id: string,
    props: TvnzS3ReplicationTestStackProps,
  ) {
    super(scope, id, props);

    const {
      sourceBucket: sourceBucketConfig,
      targetBucket: targetBucketConfig,
      replication: replicationConfig = {},
    } = props;

    // Validate source bucket name contains 'test'
    if (!sourceBucketConfig.bucketName.toLowerCase().includes("test")) {
      throw new Error('Source bucket name must contain "test" wording');
    }

    // Store target bucket name for reference
    this.targetBucketName = targetBucketConfig.bucketName;

    // Always treat as cross-account (even if same account)
    const isCrossAccount = true;

    // Determine if this is cross-region replication
    const isCrossRegion = targetBucketConfig.region !== this.region;

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

    // Create IAM role for S3 replication (SSE-S3 encryption)
    this.replicationRole = this.createReplicationRole(
      targetBucketConfig,
      isCrossAccount,
    );

    // Target bucket is assumed to exist - no creation needed
    // We'll reference it by name in replication configuration

    // Configure replication rules
    this.configureReplication(
      sourceBucketConfig,
      targetBucketConfig,
      replicationConfig,
      isCrossRegion,
    );

    // Create CloudFormation outputs
    this.createOutputs();
  }

  private createReplicationRole(
    targetBucketConfig: TvnzS3ReplicationTestStackProps["targetBucket"],
    isCrossAccount: boolean,
  ): iam.Role {
    const role = new iam.Role(this, "ReplicationRole", {
      assumedBy: new iam.ServicePrincipal("s3.amazonaws.com"),
      description: "IAM role for S3 cross-region/cross-account replication",
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
          "s3:ObjectOwnerOverrideToBucketOwner",
        ],
        resources: [`${targetBucketArn}/*`],
      }),
    );

    return role;
  }

  private configureReplication(
    sourceBucketConfig: TvnzS3ReplicationTestStackProps["sourceBucket"],
    targetBucketConfig: TvnzS3ReplicationTestStackProps["targetBucket"],
    replicationConfig: TvnzS3ReplicationTestStackProps["replication"] = {},
    isCrossRegion: boolean,
  ): void {
    const targetBucketArn = `arn:aws:s3:::${targetBucketConfig.bucketName}`;

    // Build replication destination (using SSE-S3 for target)
    const destination: s3.CfnBucket.ReplicationDestinationProperty = {
      bucket: targetBucketArn,
      // storageClass: "STANDARD_IA", // Can be configurable
      // Target bucket uses SSE-S3 encryption (default)
    };

    // Add prefix to destination if specified
    if (targetBucketConfig.prefix) {
      (destination as any).prefix = targetBucketConfig.prefix;
    }

    // Build replication rule (simplified for compatibility)
    const replicationRule: s3.CfnBucket.ReplicationRuleProperty = {
      id: "ReplicationRule",
      status: "Enabled",
      prefix: sourceBucketConfig.prefix,
      destination,
    };

    // Apply replication configuration to source bucket
    const cfnSourceBucket = this.sourceBucket.node.defaultChild as s3.CfnBucket;
    cfnSourceBucket.replicationConfiguration = {
      role: this.replicationRole.roleArn,
      rules: [replicationRule],
    };
  }

  private createOutputs(): void {
    new cdk.CfnOutput(this, "SourceBucketName", {
      value: this.sourceBucket.bucketName,
      description: "Source S3 bucket name",
      exportName: `${this.stackName}-SourceBucketName`,
    });

    new cdk.CfnOutput(this, "SourceBucketArn", {
      value: this.sourceBucket.bucketArn,
      description: "Source S3 bucket ARN",
      exportName: `${this.stackName}-SourceBucketArn`,
    });

    new cdk.CfnOutput(this, "TargetBucketName", {
      value: this.targetBucketName,
      description: "Target S3 bucket name (assumed to exist)",
      exportName: `${this.stackName}-TargetBucketName`,
    });

    new cdk.CfnOutput(this, "TargetBucketArn", {
      value: `arn:aws:s3:::${this.targetBucketName}`,
      description: "Target S3 bucket ARN (assumed to exist)",
      exportName: `${this.stackName}-TargetBucketArn`,
    });

    new cdk.CfnOutput(this, "ReplicationRoleArn", {
      value: this.replicationRole.roleArn,
      description: "S3 replication IAM role ARN",
      exportName: `${this.stackName}-ReplicationRoleArn`,
    });
  }
}
