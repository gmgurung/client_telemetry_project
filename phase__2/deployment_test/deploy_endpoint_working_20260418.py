#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
deploy_endpoint.py
==================
Deploy or update the SageMaker Real-Time Inference endpoint for
frustration scoring.
"""

import os
import re
import argparse
import boto3
from botocore.exceptions import ClientError

import sagemaker
from sagemaker.model import Model

from config import (
    MODEL_BUCKET,
    S3_MODEL_PREFIX,
    SAGEMAKER_ENDPOINT_NAME,
    SAGEMAKER_EXECUTION_ROLE,
    SAGEMAKER_REGION,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def get_execution_role(session: sagemaker.Session) -> str:
    if SAGEMAKER_EXECUTION_ROLE:
        return SAGEMAKER_EXECUTION_ROLE
    try:
        return sagemaker.get_execution_role(session)
    except ValueError as exc:
        raise RuntimeError("Could not auto-detect IAM role.") from exc


def get_latest_model_version(s3_client) -> tuple[int, str]:
    resp = s3_client.list_objects_v2(Bucket=MODEL_BUCKET, Prefix=S3_MODEL_PREFIX)
    versions = []
    for obj in resp.get("Contents", []):
        match = re.search(r"model_v(\d+)\.tar\.gz", obj["Key"])
        if match:
            versions.append((int(match.group(1)), obj["Key"]))
    if not versions:
        raise RuntimeError(f"No model tarballs found in S3.")
    v_num, s3_key = max(versions, key=lambda x: x[0])
    return v_num, f"s3://{MODEL_BUCKET}/{s3_key}"


def get_model_uri(s3_client, model_version: int) -> str:
    key = f"{S3_MODEL_PREFIX}/model_v{model_version}.tar.gz"
    try:
        s3_client.head_object(Bucket=MODEL_BUCKET, Key=key)
    except ClientError:
        raise RuntimeError(f"model_v{model_version}.tar.gz not found.")
    return f"s3://{MODEL_BUCKET}/{key}"


def get_tf_container_image(sm_session: sagemaker.Session) -> str:
    from sagemaker import image_uris
    return image_uris.retrieve(
        framework="tensorflow",
        region=sm_session.boto_region_name,
        version="2.13",
        py_version="py310",
        instance_type="ml.m5.xlarge",
        image_scope="inference",
    )


def endpoint_status(endpoint_name: str, sm_client) -> str | None:
    try:
        return sm_client.describe_endpoint(EndpointName=endpoint_name)["EndpointStatus"]
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Core deploy / update logic
# ---------------------------------------------------------------------------

def deploy_or_update(
    model_version: int,
    model_uri: str,
    endpoint_name: str,
    sm_session: sagemaker.Session,
    role: str,
) -> None:
    container = get_tf_container_image(sm_session)
    model_name = f"frustration-model-v{model_version}"
    sm_client = sm_session.boto_session.client("sagemaker")

    print(f"\n--- Starting Real-Time Deployment ---")
    print(f"Model: {model_name}")
    print(f"Target: {endpoint_name}")

    # Define the Model object
    sm_model = Model(
        image_uri=container,
        model_data=model_uri,
        role=role,
        entry_point="inference.py",
        source_dir=os.path.dirname(os.path.abspath(__file__)),
        sagemaker_session=sm_session,
        name=model_name,
        env={"SAGEMAKER_SUBMIT_DIRECTORY": "/opt/ml/code"},
    )

    # Check if endpoint exists to decide between 'deploy' or 'update'
    current_status = endpoint_status(endpoint_name, sm_client)

    if current_status is None:
        print(f"No existing endpoint found. Creating NEW endpoint '{endpoint_name}'...")
        sm_model.deploy(
            initial_instance_count=1,
            instance_type="ml.m5.xlarge",
            endpoint_name=endpoint_name
        )
    else:
        print(f"Endpoint '{endpoint_name}' exists (Status: {current_status}). Updating...")
        sm_model.deploy(
            initial_instance_count=1,
            instance_type="ml.m5.xlarge",
            endpoint_name=endpoint_name,
            update_endpoint=True
        )
    
    print(f"\n[OK] Success! SageMaker is now provisioning your ml.m5.xlarge instance.")

# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Deploy Real-Time frustration-scoring endpoint")
    parser.add_argument("--model-version", type=int, default=None)
    parser.add_argument("--endpoint-name", type=str, default=SAGEMAKER_ENDPOINT_NAME)
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--delete", action="store_true")
    args = parser.parse_args()

    sm_session = sagemaker.Session(boto_session=boto3.Session(region_name=SAGEMAKER_REGION))
    sm_client  = sm_session.boto_session.client("sagemaker")
    s3_client  = boto3.client("s3", region_name=SAGEMAKER_REGION)

    if args.status:
        status = endpoint_status(args.endpoint_name, sm_client)
        print(f"Endpoint '{args.endpoint_name}': {status if status else 'Not Found'}")
        return

    if args.delete:
        status = endpoint_status(args.endpoint_name, sm_client)
        if status:
            confirm = input(f"Delete endpoint '{args.endpoint_name}'? [y/N] ")
            if confirm.strip().lower() == "y":
                sm_client.delete_endpoint(EndpointName=args.endpoint_name)
                print(f"[OK] Deletion initiated.")
        return

    # Resolve model
    if args.model_version:
        model_uri = get_model_uri(s3_client, args.model_version)
        model_version = args.model_version
    else:
        model_version, model_uri = get_latest_model_version(s3_client)
    
    role = get_execution_role(sm_session)

    deploy_or_update(
        model_version=model_version,
        model_uri=model_uri,
        endpoint_name=args.endpoint_name,
        sm_session=sm_session,
        role=role,
    )

if __name__ == "__main__":
    main()