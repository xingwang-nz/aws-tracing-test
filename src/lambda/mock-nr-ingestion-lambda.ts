import zlib from "zlib";

/**
 * Mock NewRelic ingestion lambda used as a CloudWatch Logs subscription target.
 * It intentionally does minimal work: decode CloudWatch Logs payloads when
 * present and print them to the Lambda logs for inspection.
 */
export const handler = async (
  event: any = {}
): Promise<{ statusCode: number } | void> => {
  try {
    console.log(
      "[mock-nr-ingestion] invoked with event:",
      JSON.stringify(event)
    );

    // CloudWatch Logs subscription payloads are sent under event.awslogs.data
    if (event?.awslogs?.data) {
      const compressed = Buffer.from(event.awslogs.data, "base64");
      try {
        const decompressed = zlib.gunzipSync(compressed as any);
        const parsed = JSON.parse(decompressed.toString("utf8"));
        console.log(
          "[mock-nr-ingestion] decoded cloudwatch logs payload:",
          JSON.stringify(parsed)
        );
      } catch (err) {
        console.warn(
          "[mock-nr-ingestion] failed to decode cloudwatch logs payload:",
          err instanceof Error ? err.message : err
        );
        // fallback: log raw base64
        console.log(
          "[mock-nr-ingestion] raw awslogs.data (base64):",
          event.awslogs.data
        );
      }
    }

    // If this is not a CloudWatch Logs subscription payload, just log the event
    return { statusCode: 200 };
  } catch (err) {
    console.error(
      "[mock-nr-ingestion] handler error:",
      err instanceof Error ? err.message : err
    );
    // Do not throw — this is a test lambda that should swallow errors for convenience
    return { statusCode: 500 };
  }
};

export default handler;
