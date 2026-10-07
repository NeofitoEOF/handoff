terraform {
  required_version = ">= 1.9.0"

  backend "s3" {}

  required_providers {
    oci = {
      source  = "oracle/oci"
      version = "~> 8.29"
    }
  }
}

provider "oci" {
  region = var.region
}

provider "oci" {
  alias  = "home"
  region = var.home_region
}
