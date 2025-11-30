import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as path from "path";
import { createBasicLambda, createTracedLambda } from "./utils/lambda-utils";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as events from "aws-cdk-lib/aws-events";
import * as iam from "aws-cdk-lib/aws-iam";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as logs from "aws-cdk-lib/aws-logs";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";

export interface TvnzEventSenderStackProps extends cdk.StackProps {
  readonly eventBus: events.EventBus;
  readonly mockNrIngestionLambdaArn?: string;
}

export class TvnzEventSenderStack extends cdk.Stack {
  public readonly eventSenderLambda: lambda.Function;

  constructor(scope: Construct, id: string, props: TvnzEventSenderStackProps) {
    super(scope, id, props);

    // Ingestion function: either import by ARN (if provided) or create a local
    // mock ingestion Lambda for testing.
    let ingestionFunction: lambda.IFunction;
    if (props.mockNrIngestionLambdaArn) {
      ingestionFunction = lambda.Function.fromFunctionArn(
        this,
        "ImportedMockNrIngest",
        props.mockNrIngestionLambdaArn,
      );
      // Imported function is expected to already allow invocation by
      // CloudWatch Logs (no extra permission added here).
    } else {
      const mockNrLambda = createBasicLambda(this, {
        id: "MockNrIngestLambda",
        functionName: "tvnz-mock-nr-ingestion-lambda",
        entryPath: path.join(
          __dirname,
          "..",
          "src",
          "lambda",
          "mock-nr-ingestion-lambda.ts",
        ),
        memorySize: 256,
        timeout: cdk.Duration.seconds(10),
      });

      ingestionFunction = mockNrLambda;
    }

    // Ensure CloudWatch Logs in this account can invoke the ingestion function.
    // Create a low-level Lambda permission resource so we control the exact
    // statement and avoid the higher-level helper mutating the function's
    // resource policy unexpectedly. This grants the Logs service principal
    // permission scoped to this account (so any Log Group in the account may invoke).
    new lambda.CfnPermission(this, "AllowCloudWatchLogsInvoke", {
      functionName: ingestionFunction.functionArn,
      action: "lambda:InvokeFunction",
      principal: "logs.amazonaws.com",
      // Restrict to any CloudWatch Log Group ARN in this account/region.
      // This will synthesize a resource policy condition using ArnLike
      // for SourceArn (e.g. arn:aws:logs:ap-southeast-2:123456789:log-group:*)
      sourceArn: `arn:aws:logs:${this.region}:${this.account}:log-group:*`,
    });

    this.eventSenderLambda = createTracedLambda(this, {
      id: "EventSenderLambda",
      functionName: "tvnz-event-sender",
      entryPath: path.join(__dirname, "../src/lambda/event-sender-lambda.ts"),
    });

    // If an EventBus was provided, grant PutEvents to the sender lambda and
    // set an environment variable so the runtime knows which bus to use.
    props.eventBus.grantPutEventsTo(this.eventSenderLambda);

    this.eventSenderLambda.addEnvironment(
      "EVENT_BUS_NAME",
      props.eventBus.eventBusName,
    );

    this.eventSenderLambda.role?.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AWSXRayDaemonWriteAccess"),
    );

    // Create a low-level CloudFormation subscription filter that targets the
    // ingestion function without CDK adding a permission to the function's
    // resource policy. This assumes the target function already allows
    // CloudWatch Logs to invoke it (resource-based policy managed elsewhere).
    new logs.CfnSubscriptionFilter(
      this,
      `${this.eventSenderLambda.logGroup.node.id}-cfn-nr-subscription`,
      {
        logGroupName: this.eventSenderLambda.logGroup.logGroupName,
        filterPattern: "",
        destinationArn: ingestionFunction.functionArn,
      },
    );

    const snsSubLambda = createTracedLambda(this, {
      id: "SnsSubscriptionLambda",
      functionName: "tvnz-sns-subscription-lambda",
      entryPath: path.join(
        __dirname,
        "../src/lambda/sns-subscription-lambda.ts",
      ),
    });

    const topicName = "tvnz-topic-with-logging";

    // SNS writes delivery-status logs into a CloudWatch Logs log group it owns.
    // To avoid a CFN race where we create a subscription filter against a
    // log group that doesn't exist yet, pre-create the log group with the
    // name SNS will use. The observed format is `/aws/sns/<topicName>`.
    const deliveryStatusLogGroupName = `sns/${this.region}/${this.account}/${topicName}`;

    const snsDeliveryLogGroup = new logs.LogGroup(
      this,
      "SnsDeliveryStatusLogGroup",
      {
        logGroupName: deliveryStatusLogGroupName,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      },
    );

    // 1) Create L2 Topic
    const topic = new sns.Topic(this, "MyTopicWithDeliveryLogging", {
      topicName,
    });

    // 2) Create role SNS will assume to write delivery status logs. Use the
    // log group ARN we just created so the role policy is scoped correctly.
    const snsLoggingRole = new iam.Role(this, "SnsDeliveryLoggingRole", {
      roleName: "tvnz-sns-delivery-logging-role",
      assumedBy: new iam.ServicePrincipal("sns.amazonaws.com"),
      description: "Role used by SNS to log delivery status to CloudWatch Logs",
      inlinePolicies: {
        SNSLogWritePolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: [
                "logs:CreateLogGroup",
                "logs:CreateLogStream",
                "logs:PutLogEvents",
              ],
              resources: [`${snsDeliveryLogGroup.logGroupArn}`],
            }),
          ],
        }),
      },
    });

    // 3) Add DeliveryStatusLogging to the underlying L1 CfnTopic.
    // Use PascalCase CFN property names and lowercase protocol values.
    const cfnTopic = topic.node.defaultChild as sns.CfnTopic;
    cfnTopic.addPropertyOverride(
      "DeliveryStatusLogging",
      ["lambda", "sqs", "application", "http/s", "firehose"].map(
        (protocol) => ({
          Protocol: protocol,
          SuccessFeedbackRoleArn: snsLoggingRole.roleArn,
          FailureFeedbackRoleArn: snsLoggingRole.roleArn,
          SuccessFeedbackSampleRate: "100",
        }),
      ),
    );

    topic.addSubscription(new subscriptions.LambdaSubscription(snsSubLambda));

    new logs.CfnSubscriptionFilter(
      this,
      `${topicName}-log-cfn-nr-subscription`,
      {
        logGroupName: deliveryStatusLogGroupName,
        filterPattern: "",
        destinationArn: ingestionFunction.functionArn,
      },
    ).node.addDependency(snsDeliveryLogGroup);

    // Grant publish permission to the event sender lambda
    this.eventSenderLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["sns:Publish"],
        resources: [topic.topicArn],
      }),
    );
    this.eventSenderLambda.addEnvironment(
      "TRACING_SNS_TOPIC_ARN",
      topic.topicArn,
    );

    // sqs and lambda consumer for end-to-end tracing test can be added here
    // Create SQS queue for tracing tests
    const tracingQueue = new sqs.Queue(this, "TracingQueue", {
      queueName: "tvnz-tracing-queue",
      visibilityTimeout: cdk.Duration.seconds(60),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create the Lambda consumer that uses traced-sqs-handler (src/lambda/sqs-consumer.ts)
    const sqsConsumer = createTracedLambda(this, {
      id: "SqsTracingConsumer",
      functionName: "tvnz-sqs-tracing-consumer",
      entryPath: path.join(__dirname, "../src/lambda/sqs-consumer.ts"),
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
    });

    // Grant the Lambda permission to consume messages from the queue
    tracingQueue.grantConsumeMessages(sqsConsumer);

    // Add SQS event source mapping so Lambda will be triggered by the queue
    sqsConsumer.addEventSource(
      new SqsEventSource(tracingQueue, {
        batchSize: 5,
        maxBatchingWindow: cdk.Duration.seconds(5),
      }),
    );

    // Export queue details for easy testing
    new cdk.CfnOutput(this, "TracingQueueName", {
      value: tracingQueue.queueName,
      exportName: "tvnz-tracing-queue-name",
    });
    new cdk.CfnOutput(this, "TracingQueueArn", {
      value: tracingQueue.queueArn,
      exportName: "tvnz-tracing-queue-arn",
    });
    new cdk.CfnOutput(this, "SqsConsumerFunctionName", {
      value: sqsConsumer.functionName,
      exportName: "tvnz-sqs-tracing-consumer-name",
    });
  }
}
