import * as s3 from "aws-cdk-lib/aws-s3";
import { IBucket } from "aws-cdk-lib/aws-s3";
import * as cdk from "aws-cdk-lib";
import { IFunction } from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as iam from "aws-cdk-lib/aws-iam";
import { AwsS3 } from "../config-enum-declarations/aws-s3";
import { TEST_REPLICATION_SOURCE_BUCKET_NAME } from "../../../../bin/app-config";

type S3ReplicationRuleConfig = Pick<
  s3.CfnBucket.ReplicationRuleProperty,
  "id" | "prefix"
> & {
  destinationBucketArn: string;
  destinationAccountId?: string;
  /** Destination bucket AWS region (optional) - used to determine same-region vs cross-region */
  destinationRegion?: string;
  enableRTC?: boolean;
  rtcMinutes?: number;
  enableDeleteMarkerReplication?: boolean;
};

type S3ReplicationConfigurationProps = {
  stack: cdk.Stack;
  sourceBucket: IBucket;
  sourceBucketResource: AwsS3;
  monitorLambda?: IFunction;
  replicationRules:
    | S3ReplicationRuleConfig
    | [S3ReplicationRuleConfig, ...S3ReplicationRuleConfig[]];
};

export const S3Service = {
  cdk: {
    configureReplicationMonitoring: (input: {
      bucket: IBucket;
      monitorLambda: IFunction;
      eventTypes?: s3.EventType[];
    }): void => {
      const { bucket, monitorLambda, eventTypes } = input;

      // Default to all replication event types if none specified
      const replicationEventTypes = eventTypes || [
        s3.EventType.REPLICATION_OPERATION_FAILED_REPLICATION,
        s3.EventType.REPLICATION_OPERATION_MISSED_THRESHOLD,
        s3.EventType.REPLICATION_OPERATION_NOT_TRACKED,
        s3.EventType.REPLICATION_OPERATION_REPLICATED_AFTER_THRESHOLD,
      ];

      replicationEventTypes.forEach((eventType) => {
        bucket.addEventNotification(
          eventType,
          new s3n.LambdaDestination(monitorLambda),
        );
      });
    },

    /**
     * Configure S3 replication from a configuration object that may contain multiple rules.
     * Accepts a single S3ReplicationRuleProps or a non-empty array (compile-time enforced by the type).
     */
    configureReplication: (
      config: S3ReplicationConfigurationProps,
    ): {
      replicationRole: iam.Role;
      replicationConfiguration: s3.CfnBucket.ReplicationConfigurationProperty;
    } => {
      const { stack, sourceBucket, monitorLambda, sourceBucketResource } =
        config;
      const rulesArray = (
        Array.isArray(config.replicationRules)
          ? config.replicationRules
          : [config.replicationRules]
      ) as [S3ReplicationRuleConfig, ...S3ReplicationRuleConfig[]];

      console.log(sourceBucketResource);

      const replicationRoleName = `${TEST_REPLICATION_SOURCE_BUCKET_NAME}-replication-role`;
      const replicationRole = new iam.Role(stack, replicationRoleName, {
        assumedBy: new iam.ServicePrincipal("s3.amazonaws.com"),
        description: `IAM role for S3 replication (${replicationRoleName})`,
        roleName: replicationRoleName,
      });

      // Source permissions
      replicationRole.addToPolicy(
        new iam.PolicyStatement({
          sid: "SourceBucketPermissions",
          effect: iam.Effect.ALLOW,
          actions: [
            "s3:GetReplicationConfiguration",
            "s3:ListBucket",
            "s3:GetBucketVersioning",
          ],
          resources: [sourceBucket.bucketArn],
        }),
      );
      replicationRole.addToPolicy(
        new iam.PolicyStatement({
          sid: "SourceObjectPermissions",
          effect: iam.Effect.ALLOW,
          actions: [
            "s3:GetObjectVersion",
            "s3:GetObjectVersionAcl",
            "s3:GetObjectVersionForReplication",
            "s3:GetObjectVersionTagging",
            "s3:GetObjectRetention",
            "s3:GetObjectLegalHold",
          ],
          resources: [`${sourceBucket.bucketArn}/*`],
        }),
      );

      // Build replication rules and collect destination ARNs
      const destinationObjectArns: string[] = [];
      const replicationRules: s3.CfnBucket.ReplicationRuleProperty[] =
        rulesArray.map((replicationRule) => {
          const {
            id,
            destinationBucketArn,
            destinationAccountId,
            prefix,
            enableRTC = true,
            rtcMinutes = 15,
            enableDeleteMarkerReplication = true,
          } = replicationRule as S3ReplicationRuleConfig & {
            destinationRegion?: string;
          };

          destinationObjectArns.push(`${destinationBucketArn}/*`);

          // Only include replicationTime/metrics when RTC is explicitly enabled
          // and the destination region is the same as the stack region (same-region replication).

          const destination: s3.CfnBucket.ReplicationDestinationProperty = {
            bucket: destinationBucketArn,
            accessControlTranslation: { owner: "Destination" },
            account: destinationAccountId,
            ...(enableRTC
              ? {
                  replicationTime: {
                    status: "Enabled",
                    time: { minutes: rtcMinutes },
                  },
                }
              : {}),
            ...(enableRTC
              ? {
                  metrics: {
                    status: "Enabled",
                    eventThreshold: { minutes: rtcMinutes },
                  },
                }
              : { metrics: { status: "Disabled" } }),
          };

          return {
            id,
            status: "Enabled",
            filter: prefix ? { prefix } : undefined,
            destination,
            deleteMarkerReplication: {
              status: enableDeleteMarkerReplication ? "Enabled" : "Disabled",
            },
          } as s3.CfnBucket.ReplicationRuleProperty;
        });

      // Grant replicate permissions to all destinations
      replicationRole.addToPolicy(
        new iam.PolicyStatement({
          sid: "DestinationBucketsPermissions",
          effect: iam.Effect.ALLOW,
          actions: [
            "s3:ReplicateObject",
            "s3:ReplicateDelete",
            "s3:ReplicateTags",
          ],
          resources: destinationObjectArns,
        }),
      );

      // Always allow PutMetricData for replication metrics
      replicationRole.addToPolicy(
        new iam.PolicyStatement({
          sid: "MetricsPermissions",
          effect: iam.Effect.ALLOW,
          actions: ["cloudwatch:PutMetricData"],
          resources: ["*"],
          conditions: { StringEquals: { "cloudwatch:namespace": "AWS/S3" } },
        }),
      );

      const replicationConfig: s3.CfnBucket.ReplicationConfigurationProperty = {
        role: replicationRole.roleArn,
        rules: replicationRules,
      };

      const cfnBucket = sourceBucket.node.defaultChild as s3.CfnBucket;
      cfnBucket.replicationConfiguration = replicationConfig;

      if (monitorLambda) {
        S3Service.cdk.configureReplicationMonitoring({
          bucket: sourceBucket,
          monitorLambda,
        });
      }

      return { replicationRole, replicationConfiguration: replicationConfig };
    },
  },
};
