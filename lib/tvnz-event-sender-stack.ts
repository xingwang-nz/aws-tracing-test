import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as path from "path";
import { createTracedLambda } from "./utils/lambda-utils";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as events from "aws-cdk-lib/aws-events";
import * as iam from "aws-cdk-lib/aws-iam";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";

export interface TvnzEventSenderStackProps extends cdk.StackProps {
  readonly eventBus: events.EventBus;
}

export class TvnzEventSenderStack extends cdk.Stack {
  public readonly eventSenderLambda: lambda.Function;

  constructor(scope: Construct, id: string, props: TvnzEventSenderStackProps) {
    super(scope, id, props);

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
  }
}
