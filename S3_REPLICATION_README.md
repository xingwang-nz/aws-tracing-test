# TVNZ S3 Replication Test Stack

This simplified CDK stack provides S3 bucket replication capabilities with SSE-S3 encryption for cross-account and cross-region scenarios.

## Features

- ✅ Cross-region replication (always treated as cross-account)
- ✅ Simplified cross-account configuration
- ✅ Target bucket assumed to exist (no creation needed)
- ✅ Source bucket name must contain 'test' 
- ✅ Configurable target bucket via context
- ✅ SSE-S3 encryption (Amazon S3 managed keys)
- ✅ Configurable object prefixes
- ✅ Proper IAM permissions for cross-account scenarios
- ✅ Delete marker replication configuration
- ✅ CloudFormation outputs for key resources

## Quick Start

### 1. Basic Cross-Region Replication (Target Bucket Assumed to Exist)

```typescript
new TvnzS3ReplicationTestStack(app, "S3Replication", {
  env: { region: "ap-southeast-2" },
  sourceBucket: {
    bucketName: "my-source-test-bucket", // Must contain 'test'
    prefix: "media/", // Optional: only replicate objects with this prefix
  },
  targetBucket: {
    bucketName: "my-target-bucket", // Assumed to exist
    region: "us-west-2", // Target region (required)
    accountId: "123456789012", // Target account ID (required, even if same)
  },
});
```

### 2. Configurable Target Bucket via Context

```typescript
new TvnzS3ReplicationTestStack(app, "S3ReplicationConfigurable", {
  env: { region: "ap-southeast-2" },
  sourceBucket: {
    bucketName: "source-test-bucket-prod", // Must contain 'test'
  },
  targetBucket: {
    bucketName:
      app.node.tryGetContext("targetBucketName") || "default-target-bucket",
    region: app.node.tryGetContext("targetRegion") || "us-west-2",
    accountId: app.node.tryGetContext("targetAccountId") || "123456789012",
  },
});
```

### 3. Simple Configuration with All Objects

```typescript
new TvnzS3ReplicationTestStack(app, "S3ReplicationSimple", {
  env: { region: "ap-southeast-2" },
  sourceBucket: {
    bucketName: "source-test-bucket", // Must contain 'test'
    // No prefix = replicate all objects
  },
  targetBucket: {
    bucketName: "target-bucket", // Assumed to exist
    region: "ap-southeast-1",
    accountId: "123456789012", // Required
  },
});
```

## Configuration Options

### Source Bucket Configuration

```typescript
sourceBucket: {
  bucketName: string;      // Name of the source bucket (must contain 'test')
  prefix?: string;         // Optional prefix filter for objects to replicate
}
```

### Target Bucket Configuration

```typescript
targetBucket: {
  bucketName: string;      // Name of the target bucket (assumed to exist)
  prefix?: string;         // Optional prefix for replicated objects
  region: string;          // Target region (required)
  accountId: string;       // Target account ID (required, even if same account)
}
```

### Replication Configuration

```typescript
replication?: {
  priority?: number;                    // Replication priority (default: 1)
  deleteMarkerReplication?: boolean;    // Replicate delete markers (default: false)
}
```

## Deployment

### Deploy with Configurable Target Bucket

```bash
# Deploy with custom target bucket configuration
cdk deploy TvnzS3ReplicationTest1 \
  --context targetBucketName=my-custom-target-bucket \
  --context targetRegion=eu-west-1 \
  --context targetAccountId=987654321098
```

### Deploy Multiple Environments

```bash
# Production environment
cdk deploy TvnzS3ReplicationTest2

# Development environment with different target
cdk deploy TvnzS3ReplicationTest3 \
  --context targetBucketName=dev-target-bucket
```

## Important Notes

### Target Bucket Requirements

- **Target bucket must already exist** - this stack does not create it
- **Target bucket must have versioning enabled** for replication to work
- **Target bucket should use SSE-S3 encryption** (Amazon S3 managed keys)
- **Cross-account permissions** must be configured on the target bucket if needed

### Source Bucket Requirements

- **Source bucket name must contain "test"** - validation will fail otherwise
- **Source bucket is created with SSE-S3 encryption** (Amazon S3 managed keys)
- **Versioning is automatically enabled** on the source bucket

### Cross-Account Setup

This stack always treats replication as cross-account (even if same account):

1. **Target Account Bucket Policy**: Must allow the source account's replication role to write objects
2. **Source Account Role**: Gets permissions to read from source and write to target

## CloudFormation Outputs

The stack provides these outputs for integration:

- `SourceBucketName`: Name of the source S3 bucket
- `SourceBucketArn`: ARN of the source S3 bucket  
- `TargetBucketName`: Name of the target S3 bucket (assumed to exist)
- `TargetBucketArn`: ARN of the target S3 bucket (assumed to exist)
- `ReplicationRoleArn`: ARN of the IAM role used for replication

## Monitoring and Troubleshooting

### CloudWatch Metrics

Monitor replication through S3 CloudWatch metrics:
- `ReplicationLatency`: Time taken for replication
- `ReplicatedObjectCount`: Number of objects replicated
- `FailedReplicationCount`: Number of failed replications

### Troubleshooting Common Issues

1. **Replication Not Working**:
   - Check IAM permissions for the replication role
   - Verify target bucket exists and has versioning enabled
   - Ensure target bucket allows cross-account access

2. **Cross-Account Access Denied**:
   - Verify target account ID is correct
   - Check bucket policies on target bucket
   - Ensure target bucket allows source account's replication role

3. **Source Bucket Name Validation Error**:
   - Source bucket name must contain the word "test" (case insensitive)
   - Update bucket name to include "test" in the name

## Security Best Practices

- ✅ SSE-S3 encryption for data at rest
- ✅ Least privilege IAM permissions
- ✅ Cross-account bucket policies
- ✅ Secure SSL-only bucket access
- ✅ CloudTrail logging for audit

## Cost Optimization

- Use prefix filters to replicate only necessary objects
- Consider storage classes for replicated objects (currently set to STANDARD_IA)
- Monitor replication costs through AWS Cost Explorer
- Use lifecycle policies to manage object retention

## Example Usage

See `bin/tvnz-s3-replication.ts` for complete examples of different replication scenarios.