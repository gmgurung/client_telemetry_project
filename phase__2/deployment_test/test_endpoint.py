import json
import boto3

ENDPOINT_NAME = "frustration-scoring-endpoint"
REGION = "us-east-1"

runtime = boto3.client("sagemaker-runtime", region_name=REGION)

payload = {
    "event_count": 20,
    "page_view_count": 8,
    "unique_route_count": 4,
    "click_count": 6,
    "field_change_count": 3,
    "flow_success_count": 1,
    "flow_failure_count": 0,
    "error_event_count": 0,
    "retry_count": 0,
    "rage_click_count": 0,
    "session_duration_ms": 45000,
    "total_dwell_ms": 30000,
    "avg_inter_event_gap_ms": 2200
}

response = runtime.invoke_endpoint(
    EndpointName=ENDPOINT_NAME,
    ContentType="application/json",
    Accept="application/json",
    Body=json.dumps(payload)
)

result = response["Body"].read().decode("utf-8")
print(result)
