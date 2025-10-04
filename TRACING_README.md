# Tracing Test Stack

This CDK stack creates an API Gateway REST API with X-Ray tracing enabled, connected to a Lambda function for testing distributed tracing.

## Architecture

- **API Gateway REST API** with X-Ray tracing enabled
- **Lambda Function** (`tracing-test-lambda`) with X-Ray tracing
- **Endpoint**: `POST /api/test-tracing`

## Deployment

### Prerequisites

1. AWS CLI configured with appropriate credentials
2. AWS CDK CLI installed (`npm install -g aws-cdk`)
3. Node.js 18+ installed

### Deploy the Stack

```bash
# Bootstrap CDK (first time only)
cdk bootstrap

# Deploy the tracing test stack specifically
cdk deploy tracing-test-stack

# Or deploy all stacks
cdk deploy --all
```

### Outputs

After deployment, you'll get:

- `ApiUrl`: Base URL of the API Gateway
- `TestTracingEndpoint`: Full URL for the POST endpoint
- `LambdaFunctionName`: Name of the deployed Lambda function

## Testing

### Test the Endpoint

```bash
# Replace <API_URL> with the actual URL from CDK outputs
curl -X POST <API_URL>/api/test-tracing \
  -H "Content-Type: application/json" \
  -d '{
    "test": "data",
    "timestamp": "2025-10-05T12:00:00Z"
  }'
```

### View X-Ray Traces

1. Open AWS X-Ray console
2. Go to **Service Map** to see the API Gateway → Lambda flow
3. Go to **Traces** to view individual request traces
4. Look for traces containing both API Gateway and Lambda segments

### Sample Response

```json
{
  "message": "Tracing test successful!",
  "timestamp": "2025-10-05T12:00:00.000Z",
  "requestId": "abc123-def456-ghi789",
  "functionName": "tracing-test-lambda",
  "requestData": {
    "method": "POST",
    "path": "/api/test-tracing",
    "body": {
      "test": "data",
      "timestamp": "2025-10-05T12:00:00Z"
    }
  },
  "processing": {
    "duration": 100,
    "version": "1.0.0"
  },
  "tracing": {
    "enabled": true,
    "traceId": "_X_AMZN_TRACE_ID_VALUE"
  }
}
```

## X-Ray Tracing Features

### API Gateway Tracing

- Request/response tracing
- HTTP method and path tracking
- Response time metrics
- Error tracking

### Lambda Tracing

- Automatic Lambda runtime tracing
- Custom subsegments for business logic
- Metadata and annotations:
  - Request details (method, path, headers)
  - Processing duration
  - Environment information
  - Custom business metrics

### Custom Tracing Code

The Lambda function includes:

- Custom subsegment creation
- Metadata attachment for request details
- Annotations for filtering and searching
- Error tracking and propagation

## Cleanup

```bash
# Delete the stack
cdk destroy TracingTestStack
```

## Next Steps

This stack provides a foundation for testing distributed tracing. You can extend it by:

1. Adding more Lambda functions in the data flow
2. Integrating with other AWS services (SQS, SNS, DynamoDB)
3. Adding Step Functions for complex workflows
4. Implementing custom tracing in your business logic
5. Setting up CloudWatch alarms based on X-Ray metrics

## Troubleshooting

### No Traces Appearing

- Ensure X-Ray service has permissions
- Check that tracing is enabled on both API Gateway and Lambda
- Verify requests are reaching the endpoint (check CloudWatch logs)

### Lambda Function Errors

- Check CloudWatch logs for the Lambda function
- Verify the Lambda runtime and dependencies
- Check IAM permissions for X-Ray write access
