variable "region" {
  type        = string
  description = "OCI region, e.g. sa-saopaulo-1."
}

variable "home_region" {
  type        = string
  description = "OCI tenancy home region used for IAM operations."
}

variable "tenancy_id" {
  type        = string
  description = "OCI tenancy OCID."
}

variable "compartment_id" {
  type        = string
  description = "OCI compartment OCID for Handoff resources."
}

variable "environment" {
  type    = string
  default = "production"
}

variable "oke_worker_pools" {
  type        = any
  description = "Worker pools passed to the official OKE module."
  default = {
    handoff = {
      mode = "node-pool"
      size = 2
    }
  }
}

variable "postgres_subnet_id" {
  type        = string
  description = "Private subnet OCID used by OCI Database with PostgreSQL."
}

variable "postgres_admin_username" {
  type    = string
  default = "handoff_admin"
}

variable "postgres_admin_password" {
  type      = string
  sensitive = true
}

variable "postgres_db_version" {
  type = string
}

variable "postgres_shape" {
  type    = string
  default = "VM.Standard.E4.Flex"
}

variable "postgres_instance_count" {
  type    = number
  default = 2
}

variable "postgres_ocpus" {
  type    = number
  default = 2
}

variable "postgres_memory_gb" {
  type    = number
  default = 16
}

variable "postgres_system_type" {
  type = string
}

variable "postgres_storage_system_type" {
  type = string
}

variable "postgres_pitr_days" {
  type    = number
  default = 7
}
