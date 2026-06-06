import os
import time
import subprocess
import boto3
from config import RAW_BUCKET, S3_RAW_PREFIX, MODEL_BUCKET, S3_PROCESSED_PREFIX

CHECK_INTERVAL = 60  # check every 60 seconds
MAX_FILES_PER_CYCLE = 5

s3 = boto3.client("s3")

def list_raw_files():
    files = []
    paginator = s3.get_paginator("list_objects_v2")

    for page in paginator.paginate(Bucket=RAW_BUCKET, Prefix=S3_RAW_PREFIX):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if key.endswith(".ndjson"):
                files.append(key)

    return sorted(files)

def is_processed(key):
    filename = os.path.basename(key)
    marker_key = f"{S3_PROCESSED_PREFIX}/{filename}.done"

    try:
        s3.head_object(Bucket=MODEL_BUCKET, Key=marker_key)
        return True
    except Exception:
        return False

def process_file(key):
    s3_uri = f"s3://{RAW_BUCKET}/{key}"
    print(f"\n[NEW FILE] {s3_uri}")

    subprocess.run(
        ["python", "client.py", "--input", s3_uri],
        check=True
    )

def main():
    print("=== Polling-based automation started ===")
    print(f"Watching: s3://{RAW_BUCKET}/{S3_RAW_PREFIX}")
    print(f"Processed markers: s3://{MODEL_BUCKET}/{S3_PROCESSED_PREFIX}/")
    print(f"Check interval: {CHECK_INTERVAL} seconds")

    while True:
        try:
            raw_files = list_raw_files()
            pending = [key for key in raw_files if not is_processed(key)]

            if not pending:
                print("[INFO] No new files found.")
            else:
                print(f"[INFO] Found {len(pending)} unprocessed file(s).")

                for key in pending[:MAX_FILES_PER_CYCLE]:
                    try:
                        process_file(key)
                        print(f"[OK] Processed {key}")
                    except Exception as e:
                        print(f"[ERROR] Failed to process {key}: {e}")

            time.sleep(CHECK_INTERVAL)

        except KeyboardInterrupt:
            print("\nStopped polling.")
            break

        except Exception as e:
            print(f"[ERROR] Polling loop error: {e}")
            time.sleep(CHECK_INTERVAL)

if __name__ == "__main__":
    main()
