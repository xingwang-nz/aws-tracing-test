import * as cdk from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as events from "aws-cdk-lib/aws-events";
import { Construct } from "constructs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as httpApigateway from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as path from "path";
import { createTracedLambda, createBasicLambda } from "./utils/lambda-utils";
import * as lambda from "aws-cdk-lib/aws-lambda";

export interface TracingTestStackProps extends cdk.StackProps {
  readonly eventSenderLambda: lambda.Function;
  readonly eventBus: events.EventBus;
}

export class TracingTestStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: TracingTestStackProps) {
    super(scope, id, props);

    // Allow a shared event sender lambda to be provided by another stack.
    const eventSenderLambda = props.eventSenderLambda;

    // This stack no longer owns Step Functions or the EventBus. The
    // integration EventBus and Step Functions live in
    // TvnzIntegrationEventBusStack; events from the API are sent by the
    // shared sender lambda to that bus.

    // REST API Gateway with X-Ray tracing enabled
    const api = new apigateway.RestApi(this, "TracingTestApi", {
      restApiName: "tvnz-test-integration-rest-api-1",
      description: "API Gateway with X-Ray tracing for testing data flow",
      deployOptions: {
        stageName: "dev",
        tracingEnabled: false,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        // dataTraceEnabled: false,
        // metricsEnabled: true,
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
      eventSenderLambda,
      {
        requestTemplates: { "application/json": '{ "statusCode": "200" }' },
        proxy: true,
      }
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
    // https://belirb2aoe.execute-api.ap-southeast-2.amazonaws.com/prod/quickplay/test-tracing
    const httpApi = new httpApigateway.HttpApi(this, "TvnzTestEntryApi", {
      apiName: "tvnz-test-entry-http-api",
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
          }`
        )
      );

    const urlIntegration = new integrations.HttpUrlIntegration(
      "RestProxyIntegration",
      integrationUrl,
      {
        method: httpApigateway.HttpMethod.ANY,
        parameterMapping,
      }
    );

    httpApi.addRoutes({
      path: routePath,
      methods: [httpApigateway.HttpMethod.ANY],
      integration: urlIntegration,
    });
  }
}
