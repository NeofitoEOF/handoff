locals {
  name = "handoff-${var.environment}"

  tags = {
    application = "handoff"
    environment = var.environment
    managed_by  = "terraform"
  }
}

module "oke" {
  source  = "oracle-terraform-modules/oke/oci"
  version = "5.5.1"

  providers = {
    oci.home = oci.home
  }

  tenancy_id     = var.tenancy_id
  compartment_id = var.compartment_id

  cluster_name            = local.name
  create_vcn              = true
  vcn_name                = "${local.name}-vcn"
  vcn_cidrs               = ["10.40.0.0/16"]
  control_plane_is_public = false
  worker_is_public        = false

  create_bastion  = false
  create_operator = false

  worker_pools = var.oke_worker_pools
}

data "oci_objectstorage_namespace" "current" {
  compartment_id = var.compartment_id
}

resource "oci_objectstorage_bucket" "handoff" {
  compartment_id = var.compartment_id
  namespace      = data.oci_objectstorage_namespace.current.namespace
  name           = "${local.name}-objects"

  access_type           = "NoPublicAccess"
  object_events_enabled = true
  storage_tier          = "Standard"
  versioning            = "Enabled"

  freeform_tags = local.tags
}



resource "oci_objectstorage_bucket" "audit_anchors" {
  compartment_id = var.compartment_id
  namespace      = data.oci_objectstorage_namespace.current.namespace
  name           = "${local.name}-audit-anchors"

  access_type           = "NoPublicAccess"
  object_events_enabled = true
  storage_tier          = "Standard"
  versioning            = "Enabled"

  retention_rules {
    display_name = "${local.name}-audit-worm"

    duration {
      time_amount = tostring(var.audit_anchor_retention_days)
      time_unit   = "DAYS"
    }

    time_rule_locked = var.audit_anchor_retention_rule_lock_at
  }

  freeform_tags = local.tags
}

resource "oci_kms_vault" "handoff" {
  compartment_id = var.compartment_id
  display_name   = "${local.name}-vault"
  vault_type     = "DEFAULT"

  freeform_tags = local.tags
}

resource "oci_kms_key" "handoff" {
  compartment_id      = var.compartment_id
  display_name        = "${local.name}-master-key"
  management_endpoint = oci_kms_vault.handoff.management_endpoint

  key_shape {
    algorithm = "AES"
    length    = 32
  }

  freeform_tags = local.tags
}

resource "oci_psql_db_system" "handoff" {
  compartment_id = var.compartment_id
  display_name   = "${local.name}-postgres"
  db_version     = var.postgres_db_version
  shape          = var.postgres_shape
  system_type    = var.postgres_system_type

  instance_count              = var.postgres_instance_count
  instance_ocpu_count         = var.postgres_ocpus
  instance_memory_size_in_gbs = var.postgres_memory_gb

  credentials {
    username = var.postgres_admin_username

    password_details {
      password_type = "PLAIN_TEXT"
      password      = var.postgres_admin_password
    }
  }

  network_details {
    subnet_id                  = var.postgres_subnet_id
    is_reader_endpoint_enabled = true
  }

  storage_details {
    is_regionally_durable = true
    system_type           = var.postgres_storage_system_type
  }

  management_policy {
    pitr_policy {
      kind         = "STANDARD"
      restore_days = var.postgres_pitr_days
    }
  }

  freeform_tags = local.tags
}
