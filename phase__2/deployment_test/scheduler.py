import schedule
import time
import subprocess
import boto3
import os
from datetime import datetime
from config import RAW_BUCKET, S3_RAW_PREFIX

# --- Configuration ---
BUCKET_NAME = RAW_BUCKET
PREFIX = S3_RAW_PREFIX
PROCESSED_LOG = "processed_files.log" 

def get_latest_s3_file(bucket, prefix):
    """Scans S3 and returns the newest file metadata."""
    s3_client = boto3.client('s3')
    
    try:
        response = s3_client.list_objects_v2(Bucket=bucket, Prefix=prefix)
        if 'Contents' not in response:
            return None
            
        sorted_files = sorted(response['Contents'], key=lambda x: x['LastModified'], reverse=True)
        
        for file in sorted_files:
            key = file['Key']
            # Skip folders or empty keys
            if key.endswith('/') or not key.strip():
                continue
            return key 
            
        return None   
    except Exception as e:
        print(f"Error accessing S3: {e}")
        return None

def is_file_new(file_key):
    """Checks the local log to see if we have already processed this specific key."""
    if not os.path.exists(PROCESSED_LOG):
        return True
    
    with open(PROCESSED_LOG, "r") as f:
        processed_list = f.read().splitlines()
    
    return file_key not in processed_list

def mark_as_processed(file_key):
    """Adds the file key to our local history log."""
    with open(PROCESSED_LOG, "a") as f:
        f.write(file_key + "\n")

def run_inference_pipeline():
    print(f"\n[{datetime.now().strftime('%H:%M:%S')}] Monitoring S3 for new data...")
    
    latest_key = get_latest_s3_file(BUCKET_NAME, PREFIX)
    
    if not latest_key:
        print("No files found in S3.")
        return

    # Check if this is a fresh file
    if is_file_new(latest_key):
        full_s3_path = f"s3://{BUCKET_NAME}/{latest_key}"
        print(f"NEW FILE DETECTED: {latest_key}")
        print(f"Triggering inference.py for {full_s3_path}...")
        
        try:
            subprocess.run([
                "python", 
                "inference.py", 
                "--input", 
                full_s3_path
            ], check=True)
            
            mark_as_processed(latest_key)
            print(f"[SUCCESS] {latest_key} processed and logged.")
            
        except subprocess.CalledProcessError as e:
            print(f"ERROR: Inference script failed for {latest_key}. Will retry next cycle.")
    else:
        print(f"No new data. (Latest file {latest_key} has already been processed).")

# --- Scheduler Startup ---
print(f"=== Pipeline Scheduler Started ===")
print(f"Target: s3://{BUCKET_NAME}/{PREFIX}")
print(f"Tracking: {PROCESSED_LOG}")

run_inference_pipeline() 

# Schedule for every 2 minutes
schedule.every(2).minutes.do(run_inference_pipeline)

while True:
    schedule.run_pending()
    time.sleep(1)