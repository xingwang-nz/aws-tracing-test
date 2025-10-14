import * as cdk from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as logs from "aws-cdk-lib/aws-logs";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as stepfunctions from "aws-cdk-lib/aws-stepfunctions";
import * as sfnTasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import { Construct } from "constructs";
import * as httpApigateway from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as path from "path";
import { createTracedLambda } from "./lambda-utils";

export class TracingTestStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Lambda function with X-Ray tracing enabled
    const tracingTestLambda = createTracedLambda(this, {
      id: "TracingTestLambda",
      functionName: "tracing-test-lambda",
      entryPath: path.join(
        __dirname,
        "../src/lambda/tracing-test-lambda/index.ts",
      ),
    });

    // Custom EventBridge event bus with X-Ray tracing
    const tracingEventBus = new events.EventBus(this, "TracingEventBus", {
      eventBusName: "tracing-test",
    });

    // Grant the lambda permission to publish events to the custom event bus
    tracingEventBus.grantPutEventsTo(tracingTestLambda);

    // Add environment variable for the event bus ARN
    tracingTestLambda.addEnvironment(
      "EVENT_BUS_NAME",
      tracingEventBus.eventBusName,
    );

    // Step Functions controller lambda
    const sfControllerLambda = createTracedLambda(this, {
      id: "SfControllerLambda",
      functionName: "tracing-test-sf-controller-lambda",
      entryPath: path.join(
        __dirname,
        "../src/lambda/tracing-test-sf-controller-lambda/index.ts",
      ),
    });

    // Business Lambda function
    const businessLambda = createTracedLambda(this, {
      id: "BusinessLambda",
      functionName: "tracing-test-lambda-business",
      entryPath: path.join(
        __dirname,
        "../src/lambda/tracing-test-lambda-business/index.ts",
      ),
    });

    // Business Step Functions state machine
    const businessProcessTask = new sfnTasks.LambdaInvoke(
      this,
      "BusinessProcessTask",
      {
        lambdaFunction: businessLambda,
        outputPath: "$",
      },
    );

    const businessDefinition = businessProcessTask;

    // Create CloudWatch Log Group for Business Step Functions
    const businessStepFunctionLogGroup = new logs.LogGroup(
      this,
      "BusinessStepFunctionLogGroup",
      {
        logGroupName: "/aws/stepfunctions/tracing-test-sf-business",
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      },
    );

    const businessStepFunction = new stepfunctions.StateMachine(
      this,
      "BusinessStepFunction",
      {
        stateMachineName: "tracing-test-sf-business",
        definition: businessDefinition,
        tracingEnabled: true,
        logs: {
          destination: businessStepFunctionLogGroup,
          level: stepfunctions.LogLevel.ALL,
          includeExecutionData: true,
        },
      },
    );

    // Grant the controller lambda permission to start business step function executions
    businessStepFunction.grantStartExecution(sfControllerLambda);

    // Add environment variable for the business step function ARN
    sfControllerLambda.addEnvironment(
      "BUSINESS_STEP_FUNCTION_ARN",
      businessStepFunction.stateMachineArn,
    );

    // Step Functions state machine
    const processEventTask = new sfnTasks.LambdaInvoke(
      this,
      "ProcessEventTask",
      {
        lambdaFunction: sfControllerLambda,
        outputPath: "$",
      },
    );

    const definition = processEventTask;

    // Create CloudWatch Log Group for Step Functions
    const stepFunctionLogGroup = new logs.LogGroup(
      this,
      "StepFunctionLogGroup",
      {
        logGroupName: "/aws/stepfunctions/tracing-test-sf",
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      },
    );

    const tracingStepFunction = new stepfunctions.StateMachine(
      this,
      "TracingStepFunction",
      {
        stateMachineName: "tracing-test-sf",
        definition,
        tracingEnabled: true,
        logs: {
          destination: stepFunctionLogGroup,
          level: stepfunctions.LogLevel.ALL,
          includeExecutionData: true,
        },
      },
    );

    // EventBridge rule to trigger Step Functions
    const eventRule = new events.Rule(this, "TracingEventRule", {
      eventBus: tracingEventBus,
      eventPattern: {
        source: ["tracing-test"],
        detailType: ["API Gateway Event"],
      },
    });

    // (moved HTTP API creation to after the REST API definition below)

    // Add Step Functions as target
    eventRule.addTarget(
      new targets.SfnStateMachine(tracingStepFunction, {
        input: events.RuleTargetInput.fromEventPath("$"),
      }),
    );

    // REST API Gateway with X-Ray tracing enabled
    const api = new apigateway.RestApi(this, "TracingTestApi", {
      restApiName: "tracing-test-api",
      description: "API Gateway with X-Ray tracing for testing data flow",
      deployOptions: {
        stageName: "dev",
        tracingEnabled: true,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
        metricsEnabled: true,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: ["POST", "OPTIONS"],
        allowHeaders: [
          "Content-Type",
          "X-Amz-Date",
          "Authorization",
          "X-Api-Key",
        ],
      },
    });

    // Create /api resource
    const apiResource = api.root.addResource("api");

    // Create /api/test-tracing resource
    const testTracingResource = apiResource.addResource("test-tracing");

    // Lambda integration
    const lambdaIntegration = new apigateway.LambdaIntegration(
      tracingTestLambda,
      {
        requestTemplates: { "application/json": '{ "statusCode": "200" }' },
        proxy: true,
      },
    );

    // Add POST method to /api/test-tracing
    testTracingResource.addMethod("POST", lambdaIntegration, {
      operationName: "TestTracing",
      methodResponses: [
        {
          statusCode: "200",
          responseModels: {
            "application/json": apigateway.Model.EMPTY_MODEL,
          },
        },
        {
          statusCode: "400",
          responseModels: {
            "application/json": apigateway.Model.ERROR_MODEL,
          },
        },
      ],
    });

    // --- HTTP API (L2) proxy to the REST API ---
    const httpApi = new httpApigateway.HttpApi(this, "TvnzTestEntryApi", {
      apiName: "tvnz-test-entry-api-gateway",
    });

    new httpApigateway.HttpStage(this, "TvnzTestEntryStage", {
      httpApi,
      stageName: "prod",
      autoDeploy: true,
    });

    // --- ApiMapping with multi-level path for Http Api with domain---

    // Build the integration URI using the RestApi invoke URL (api.url token)
    // and appending the desired path. The token is resolved at deploy time.
    // const integrationUrl = cdk.Fn.join("", [api.url, "api/{proxy}"]);

    // Route exposed on the HTTP API for clients
    const routePath = "/quickplay/{proxy+}";

    // Build the integration URI using the RestApi invoke URL (api.url token)
    // and appending the desired backend path. ApiGatewayV2 requires a full
    // HTTP endpoint (including scheme), so use Fn.join to concatenate the
    // RestApi URL token and the backend path.
    const integrationUrl = cdk.Fn.join("", [api.url, "{proxy}"]);

    // Rewrite incoming path /quickplay/{proxy+} -> /{stage}/api/{proxy}
    const parameterMapping =
      new httpApigateway.ParameterMapping().overwritePath(
        httpApigateway.MappingValue.custom(
          `/${api.deploymentStage.stageName}/api/${
            httpApigateway.MappingValue.requestPathParam("proxy").value
          }`,
        ),
      );

    const urlIntegration = new integrations.HttpUrlIntegration(
      "RestProxyIntegration",
      integrationUrl,
      {
        method: httpApigateway.HttpMethod.ANY,
        parameterMapping,
      },
    );

    httpApi.addRoutes({
      path: routePath,
      methods: [httpApigateway.HttpMethod.ANY],
      integration: urlIntegration,
    });
  }
}
