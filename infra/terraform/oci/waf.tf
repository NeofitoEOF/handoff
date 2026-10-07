resource "oci_waf_web_app_firewall_policy" "handoff" {
  count          = var.waf_enabled ? 1 : 0
  compartment_id = var.compartment_id
  display_name   = "${local.name}-waf-policy"

  actions {
    name = "allow"
    type = "ALLOW"
  }

  actions {
    name = "rateLimitExceeded"
    type = "RETURN_HTTP_RESPONSE"
    code = 429

    body {
      type = "STATIC_TEXT"
      text = "{\"message\":\"Too many requests\"}"
    }

    headers {
      name  = "Content-Type"
      value = "application/json"
    }
  }

  request_access_control {
    default_action_name = "allow"
  }

  request_rate_limiting {
    rules {
      type        = "REQUEST_RATE_LIMITING"
      name        = "globalRateLimit"
      action_name = "rateLimitExceeded"

      configurations {
        period_in_seconds          = 60
        requests_limit             = var.waf_requests_per_minute
        action_duration_in_seconds = 60
      }
    }
  }

  freeform_tags = local.tags
}

resource "oci_waf_web_app_firewall" "handoff" {
  count                      = var.waf_enabled ? 1 : 0
  compartment_id             = var.compartment_id
  backend_type               = "LOAD_BALANCER"
  load_balancer_id           = var.waf_load_balancer_id
  web_app_firewall_policy_id = oci_waf_web_app_firewall_policy.handoff[0].id
  display_name               = "${local.name}-waf"

  lifecycle {
    precondition {
      condition     = var.waf_load_balancer_id != null && var.waf_load_balancer_id != ""
      error_message = "waf_load_balancer_id must be set when waf_enabled=true."
    }
  }

  freeform_tags = local.tags
}
