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

    // Create an SNS topic and a subscription lambda that logs X-Ray info
    const tracingTopic = new sns.Topic(this, "TvnzTestTracingTopic", {
      topicName: "tvnz-test-tracing-topic",
    });

    const snsSubLambda = createTracedLambda(this, {
      id: "SnsSubscriptionLambda",
      functionName: "tvnz-sns-subscription-lambda",
      entryPath: path.join(
        __dirname,
        "../src/lambda/sns-subscription-lambda.ts",
      ),
    });

    // Subscribe the lambda to the topic
    tracingTopic.addSubscription(
      new subscriptions.LambdaSubscription(snsSubLambda),
    );

    // Grant publish permission to the event sender lambda and set env var
    tracingTopic.grantPublish(this.eventSenderLambda);
    this.eventSenderLambda.addEnvironment(
      "TRACING_SNS_TOPIC_ARN",
      tracingTopic.topicArn,
    );

    ////////////////////
    // sns logging
    const snsLogGroup = new logs.LogGroup(this, "SnsDeliveryStatusLogGroup", {
      logGroupName: "/aws/sns/tvnz-delivery-status",
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

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
              resources: [`${snsLogGroup.logGroupArn}:*`],
            }),
          ],
        }),
      },
    });

    const topicCfn = new sns.CfnTopic(this, "MyTopicWithDeliveryLogging", {
      topicName: "tvnz-topic-with-logging",
      deliveryStatusLogging: [
        "lambda",
        "sqs",
        "application",
        "http/s",
        "firehose",
      ].map((protocol) => ({
        protocol: protocol,
        successFeedbackRoleArn: snsLoggingRole.roleArn,
        failureFeedbackRoleArn: snsLoggingRole.roleArn,
      })),
    });
  }
}
