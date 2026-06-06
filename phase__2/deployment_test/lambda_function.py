import json
import os
import boto3
from datetime import datetime
from urllib.parse import unquote_plus

s3 = boto3.client("s3")

MODEL_BUCKET = os.environ.get("MODEL_BUCKET", "sagemaker-studio-i0gutcxdy")
PROCESSED_PREFIX = os.environ.get("S3_PROCESSED_PREFIX", "frustration-model/processed_markers")

def lambda_handler(event, context):
    print("Received event:", json.dumps(event))

    records = event.get("Records", [])
    if not records:
        return {"status": "no_records"}

    processed = []

    for record in records:
        bucket = record["s3"]["bucket"]["name"]
        key = unquote_plus(record["s3"]["object"]["key"])

        if key.endswith("/") or not key.endswith(".ndjson"):
            print(f"Skipping non-ndjson object: s3://{bucket}/{key}")
            continue

        filename = os.path.basename(key)
        marker_key = f"{PROCESSED_PREFIX}/{filename}.done"

        try:
            s3.head_object(Bucket=MODEL_BUCKET, Key=marker_key)
            print(f"Already processed: {filename}")
            continue
        except Exception:
            pass

        s3.put_object(
            Bucket=MODEL_BUCKET,
            Key=marker_key,
            Body=json.dumps({
                "processed_at": datetime.utcnow().isoformat(),
                "source": f"s3://{bucket}/{key}",
                "status": "lambda_test_only"
            })
        )

        print(f"Created marker: s3://{MODEL_BUCKET}/{marker_key}")
        processed.append(f"s3://{bucket}/{key}")

    return {"processed": processed}
