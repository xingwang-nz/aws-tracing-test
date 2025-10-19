import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as stepfunctions from "aws-cdk-lib/aws-stepfunctions";
import * as sfnTasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import * as logs from "aws-cdk-lib/aws-logs";
import * as path from "path";
import { createTracedLambda } from "./utils/lambda-utils";

export interface IntegrationEventBusStackProps extends cdk.StackProps {}

export class TvnzIntegrationEventBusStack extends cdk.Stack {
  public readonly eventBus: events.EventBus;
  public readonly integrationStateMachine: stepfunctions.StateMachine;
  public readonly businessStateMachine: stepfunctions.StateMachine;

  constructor(
    scope: Construct,
    id: string,
    props?: IntegrationEventBusStackProps,
  ) {
    super(scope, id, props);

    // EventBridge event bus
    this.eventBus = new events.EventBus(this, "IntegrationEventBus", {
      eventBusName: "tvnz-test-integration-bus",
    });

    // Controller Lambda
    const sfControllerLambda = createTracedLambda(this, {
      id: "tvnz-test-sf-controller-lambda",
      functionName: "tvnz-test-integration-controller",
      entryPath: path.join(
        __dirname,
        "../src/lambda/integration-controller-lambda.ts",
      ),
    });

    // Business Lambdas
    const businessLambda1 = createTracedLambda(this, {
      id: "tvnz-test-business-lambda-1",
      functionName: "tvnz-test-business-1",
      entryPath: path.join(
        __dirname,
        "../src/lambda/business/business-lambda-1.ts",
      ),
    });

    const businessLambda2 = createTracedLambda(this, {
      id: "tvnz-test-business-lambda-2",
      functionName: "tvnz-test-business-2",
      entryPath: path.join(
        __dirname,
        "../src/lambda/business/business-lambda-2.ts",
      ),
    });

    // Step Function log group
    const stepFunctionLogGroup = new logs.LogGroup(
      this,
      "StepFunctionLogGroup",
      {
        logGroupName: "/aws/stepfunctions/tvnz-test-state-machine-lg",
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      },
    );

    // Business state machine
    const businessTask1 = new sfnTasks.LambdaInvoke(this, "BusinessTask1", {
      lambdaFunction: businessLambda1,
      outputPath: "$",
    });

    const businessTask2 = new sfnTasks.LambdaInvoke(this, "BusinessTask2", {
      lambdaFunction: businessLambda2,
      outputPath: "$",
    });

    this.businessStateMachine = new stepfunctions.StateMachine(
      this,
      "BusinessStateMachine",
      {
        stateMachineName: "tvnz-test-business",
        definition: businessTask1.next(businessTask2),
        tracingEnabled: true,
        logs: {
          destination: stepFunctionLogGroup,
          level: stepfunctions.LogLevel.ALL,
          includeExecutionData: true,
        },
      },
    );

    // Allow controller Lambda to start the business state machine
    this.businessStateMachine.grantStartExecution(sfControllerLambda);
    sfControllerLambda.addEnvironment(
      "BUSINESS_SFN_ARN",
      this.businessStateMachine.stateMachineArn,
    );

    // Integration state machine which invokes controller lambda
    const dispatchEventTask = new sfnTasks.LambdaInvoke(
      this,
      "DispatchEventTask",
      {
        lambdaFunction: sfControllerLambda,
        outputPath: "$",
      },
    );

    this.integrationStateMachine = new stepfunctions.StateMachine(
      this,
      "IntegrationStateMachine",
      {
        stateMachineName: "tvnz-test-integration",
        definition: dispatchEventTask,
        tracingEnabled: true,
        logs: {
          destination: stepFunctionLogGroup,
          level: stepfunctions.LogLevel.ALL,
          includeExecutionData: true,
        },
      },
    );

    // EventBridge rule to trigger Integration state machine
    const integrationEventRule = new events.Rule(this, "IntegrationEventRule", {
      eventBus: this.eventBus,
      eventPattern: {
        source: ["api-gateway"],
        detailType: ["API Gateway Event"],
      },
    });

    integrationEventRule.addTarget(
      new targets.SfnStateMachine(this.integrationStateMachine, {
        input: events.RuleTargetInput.fromEventPath("$"),
      }),
    );
  }
}
