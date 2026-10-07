#!/usr/bin/env sh
set -eu

: "${OCI_STATE_BUCKET:?OCI_STATE_BUCKET is required}"
: "${OCI_OBJECT_STORAGE_NAMESPACE:?OCI_OBJECT_STORAGE_NAMESPACE is required}"
: "${OCI_REGION:?OCI_REGION is required}"
: "${TF_STATE_KEY:?TF_STATE_KEY is required}"
: "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID is required}"
: "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY is required}"

endpoint="https://${OCI_OBJECT_STORAGE_NAMESPACE}.compat.objectstorage.${OCI_REGION}.oraclecloud.com"

terraform init \
  -backend-config="bucket=${OCI_STATE_BUCKET}" \
  -backend-config="key=${TF_STATE_KEY}" \
  -backend-config="region=${OCI_REGION}" \
  -backend-config="endpoint=${endpoint}" \
  -backend-config="skip_credentials_validation=true" \
  -backend-config="skip_region_validation=true" \
  -backend-config="skip_requesting_account_id=true" \
  -backend-config="skip_metadata_api_check=true" \
  -backend-config="use_path_style=true"
