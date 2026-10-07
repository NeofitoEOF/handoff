output "oke_cluster_id" {
  value = module.oke.cluster_id
}

output "object_storage_bucket" {
  value = oci_objectstorage_bucket.handoff.name
}

output "vault_id" {
  value = oci_kms_vault.handoff.id
}

output "vault_key_id" {
  value = oci_kms_key.handoff.id
}

output "postgres_id" {
  value = oci_psql_db_system.handoff.id
}

output "postgres_primary_endpoint" {
  value = try(oci_psql_db_system.handoff.network_details[0].primary_db_endpoint_private_ip, null)
}


output "waf_policy_id" {
  value = try(oci_waf_web_app_firewall_policy.handoff[0].id, null)
}

output "waf_id" {
  value = try(oci_waf_web_app_firewall.handoff[0].id, null)
}


output "audit_anchor_bucket" {
  value = oci_objectstorage_bucket.audit_anchors.name
}
