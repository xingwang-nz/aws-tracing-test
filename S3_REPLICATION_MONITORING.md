# S3 Replication Failure Monitoring

This setup monitors S3 replication failures and sends alerts based on the AWS documentation at: https://docs.aws.amazon.com/AmazonS3/latest/userguide/replication-metrics-events.html

## Architecture

```
S3 Bucket (Source)
    ↓ (Replication Events)
Lambda Function (s3-replication-monitor)
    ↓
CloudWatch Logs + SNS Alerts
```

## Monitored Events

The system monitors these S3 replication events:

1. **`s3:Replication:OperationFailedReplication`** - Object failed to replicate
2. **`s3:Replication:OperationMissedThreshold`** - Object exceeded 15-minute replication threshold (S3 RTC)
3. **`s3:Replication:OperationReplicatedAfterThreshold`** - Object replicated after threshold
4. **`s3:Replication:OperationNotTracked`** - Object no longer tracked by replication metrics

## Event Structure

The replication failure events follow this structure:

```json
{
  "Records": [
    {
      "eventVersion": "2.2",
      "eventSource": "aws:s3",
      "awsRegion": "us-east-1",
      "eventTime": "2024-09-05T21:04:32.527Z",
      "eventName": "Replication:OperationFailedReplication",
      "s3": {
        "bucket": { "name": "source-bucket" },
        "object": { "key": "file.txt", "size": 520080 }
      },
      "replicationEventData": {
        "replicationRuleId": "rule-id",
        "destinationBucket": "arn:aws:s3:::target-bucket",
        "s3Operation": "OBJECT_PUT",
        "failureReason": "AssumeRoleNotPermitted"
      }
    }
  ]
}
```

## Lambda Function Features

The `s3-replication-monitor/index.ts` Lambda function:

### ✅ **CloudWatch Logs Integration**

- Logs all replication events to `/aws/s3/replication-monitor/{bucket-name}`
- Creates daily log streams
- Structured JSON logging for easy querying

### ✅ **SNS Alerts**

- Sends notifications for replication failures
- Includes recommended actions based on failure reason
- Subject: `🚨 S3 Replication Failure: {bucket}/{object}`

### ✅ **Failure Reason Analysis**

Provides specific recommendations for common failure reasons:

- **AssumeRoleNotPermitted**: Check IAM role permissions
- **DstBucketNotFound**: Verify destination bucket exists
- **DstBucketUnversioned**: Enable versioning on destination
- **DstKmsKeyNotFound**: Check KMS key configuration
- **DstPutObjectNotPermitted**: Verify s3:ReplicateObject permissions
- **SrcGetObjectNotPermitted**: Check source object permissions

### ✅ **Event Type Handling**

- 🚨 **Failures**: Critical alerts with detailed analysis
- ⏰ **Missed Threshold**: Warning for RTC threshold exceeded
- ✅ **After Threshold**: Info when eventually replicated
- 🔍 **Not Tracked**: Warning for untracked objects

## CloudWatch Logs Queries

### Failed Replications

```
fields @timestamp, eventName, bucketName, objectKey, failureReason
| filter eventName = "s3:Replication:OperationFailedReplication"
| sort @timestamp desc
```

### Replication by Failure Reason

```
fields @timestamp, failureReason, bucketName, objectKey
| filter eventName = "s3:Replication:OperationFailedReplication"
| stats count() by failureReason
```

### Objects Exceeding Threshold

```
fields @timestamp, bucketName, objectKey, destinationBucket
| filter eventName like /Threshold/
| sort @timestamp desc
```

## Deployment

The monitoring is automatically set up when you deploy the S3 replication stack:

```bash
cdk deploy tvnz-s3-replication-test-stack
```

## Configuration

### Environment Variables

- `LOG_GROUP_NAME`: CloudWatch Log Group for events
- `SNS_TOPIC_ARN`: SNS Topic for failure alerts

### Optional Email Notifications

Uncomment in the CDK stack to add email subscriptions:

```typescript
this.replicationMonitorTopic.addSubscription(
  new subscriptions.EmailSubscription("your-email@example.com"),
);
```

## Troubleshooting

### Common Issues

1. **No Events Received**:

   - Ensure S3 Replication metrics are enabled
   - Check bucket notification permissions
   - Verify Lambda function has proper IAM permissions

2. **SNS Not Working**:

   - Check Lambda execution role has SNS publish permissions
   - Verify SNS topic exists and is accessible

3. **CloudWatch Logs Missing**:
   - Check Lambda execution role has CloudWatch Logs permissions
   - Verify log group exists and is accessible

### Testing

To test the monitoring:

1. **Create a replication failure** by:

   - Removing IAM permissions temporarily
   - Using invalid destination bucket
   - Disabling destination bucket versioning

2. **Check CloudWatch Logs** at:
   `/aws/s3/replication-monitor/{bucket-name}`

3. **Verify SNS notifications** are sent for failures

## Security

- Lambda function uses least-privilege IAM permissions
- CloudWatch Logs encrypted at rest
- SNS topic can be encrypted with KMS keys
- All resources follow AWS security best practices

## Cost Optimization

- CloudWatch Logs retention: 2 weeks (configurable)
- Lambda memory: 256MB (optimized for event processing)
- Lambda timeout: 60 seconds (adequate for processing)
- SNS charges apply only when notifications are sent
