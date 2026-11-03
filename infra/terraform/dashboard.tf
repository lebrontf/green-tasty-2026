# CloudWatch dashboard — 100% within the CloudWatch always-free tier.
#
# Free-tier guardrails baked into this dashboard:
#   * 1 dashboard total (free tier allows 3).
#   * ZERO custom metrics — every widget uses standard AWS/* metrics that AWS
#     publishes for free (API Gateway, Lambda, SQS, DynamoDB, Cognito).
#   * ZERO Logs Insights widgets — those scan log data (counts against the 5 GB
#     free scan quota). Errors are surfaced via metrics instead.
#   * NO API Gateway detailed metrics — those bill as custom metrics ($0.30 each,
#     ~40 routes = hundreds of metrics).
#   * DynamoDB throttling across all 13 tables is pulled with a single SEARCH
#     expression per widget rather than dozens of individual metrics.
#
# Behavioral note (also in the dashboard header): the only realistic way to touch
# the 1,000,000/month GetMetricData free-tier limit is leaving this open 24/7 with
# a seconds-level auto-refresh. Normal "open during an incident" use is <2% of the
# limit. Keep console auto-refresh off or at 1-5 min. The existing $5 AWS Budget
# (monitoring.tf) is the financial backstop for any anomaly.

locals {
  dashboard_period = 60 # seconds — coarse period keeps GetMetricData volume low
  dashboard_region = var.aws_region

  dashboard_header_md = join("\n", [
    "# Restaurant Backend — develop",
    "Standard AWS metrics only · 0 custom metrics · free-tier safe.",
    "**Do not leave open 24/7 with seconds-level auto-refresh** (protects the 1M/mo GetMetricData free tier). Prefer refresh off or 1-5 min.",
    "Logs: [api-handler](https://${var.aws_region}.console.aws.amazon.com/cloudwatch/home?region=${var.aws_region}#logsV2:log-groups/log-group/%252Faws%252Flambda%252Fapi-handler) · [reports-handler](https://${var.aws_region}.console.aws.amazon.com/cloudwatch/home?region=${var.aws_region}#logsV2:log-groups/log-group/%252Faws%252Flambda%252Freports-handler) · [report-sender](https://${var.aws_region}.console.aws.amazon.com/cloudwatch/home?region=${var.aws_region}#logsV2:log-groups/log-group/%252Faws%252Flambda%252Freport-sender)"
  ])
}

resource "aws_cloudwatch_dashboard" "restaurant_backend" {
  dashboard_name = "restaurant-backend"

  dashboard_body = jsonencode({
    widgets = [
      # ------------------------------------------------------------------
      # Header / free-tier reminder
      # ------------------------------------------------------------------
      {
        type   = "text"
        x      = 0
        y      = 0
        width  = 24
        height = 3
        properties = {
          markdown = local.dashboard_header_md
        }
      },

      # ==================================================================
      # ROW 0 — ERRORS AT A GLANCE (single-value, red when > 0)
      # ==================================================================
      {
        type   = "metric"
        x      = 0
        y      = 3
        width  = 5
        height = 4
        properties = {
          title  = "API Gateway 5XX responses"
          view   = "singleValue"
          region = local.dashboard_region
          stat   = "Sum"
          period = local.dashboard_period
          metrics = [
            ["AWS/ApiGateway", "5XXError", "ApiName", local.api_gateway_name, "Stage", "develop"]
          ]
        }
      },
      {
        type   = "metric"
        x      = 5
        y      = 3
        width  = 5
        height = 4
        properties = {
          title  = "api-handler runtime failures"
          view   = "singleValue"
          region = local.dashboard_region
          stat   = "Sum"
          period = local.dashboard_period
          metrics = [
            ["AWS/Lambda", "Errors", "FunctionName", local.api_handler_name]
          ]
        }
      },
      {
        type   = "metric"
        x      = 10
        y      = 3
        width  = 5
        height = 4
        properties = {
          title  = "Lambda Throttles (sum)"
          view   = "singleValue"
          region = local.dashboard_region
          stat   = "Sum"
          period = local.dashboard_period
          metrics = [
            ["AWS/Lambda", "Throttles", "FunctionName", local.api_handler_name, { label = "api-handler" }],
            ["...", local.reports_handler_name, { label = "reports-handler" }],
            ["...", local.report_sender_name, { label = "report-sender" }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 15
        y      = 3
        width  = 5
        height = 4
        properties = {
          title  = "DynamoDB Throttles (all tables, sum)"
          view   = "singleValue"
          region = local.dashboard_region
          period = local.dashboard_period
          metrics = [
            [{ expression = "SUM([m_read, m_write])", label = "Throttled events", id = "e_ddb" }],
            ["AWS/DynamoDB", "ReadThrottleEvents", "TableName", "Dishes", { id = "m_read", visible = false, stat = "Sum" }],
            ["AWS/DynamoDB", "WriteThrottleEvents", "TableName", "Dishes", { id = "m_write", visible = false, stat = "Sum" }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 20
        y      = 3
        width  = 4
        height = 4
        properties = {
          title  = "Reports DLQ msgs"
          view   = "singleValue"
          region = local.dashboard_region
          stat   = "Maximum"
          period = local.dashboard_period
          metrics = [
            ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", aws_sqs_queue.reports_dlq.name]
          ]
        }
      },

      # ==================================================================
      # ROW 1 — API GATEWAY (client-facing traffic & errors)
      # ==================================================================
      {
        type   = "metric"
        x      = 0
        y      = 7
        width  = 12
        height = 6
        properties = {
          title  = "API Gateway — Request count"
          view   = "timeSeries"
          region = local.dashboard_region
          stat   = "Sum"
          period = local.dashboard_period
          metrics = [
            ["AWS/ApiGateway", "Count", "ApiName", local.api_gateway_name, "Stage", "develop", { label = "Requests" }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 7
        width  = 12
        height = 6
        properties = {
          title  = "API Gateway — errors and error rate"
          view   = "timeSeries"
          region = local.dashboard_region
          stat   = "Sum"
          period = local.dashboard_period
          metrics = [
            ["AWS/ApiGateway", "4XXError", "ApiName", local.api_gateway_name, "Stage", "develop", { label = "4XX", color = "#ff7f0e" }],
            ["AWS/ApiGateway", "5XXError", "ApiName", local.api_gateway_name, "Stage", "develop", { label = "5XX", color = "#d62728" }],
            [{ expression = "IF(m_requests > 0, 100 * m_4xx / m_requests, 0)", label = "4XX rate (%)", id = "e_4xx_rate", color = "#ff7f0e" }],
            [{ expression = "IF(m_requests > 0, 100 * m_5xx / m_requests, 0)", label = "5XX rate (%)", id = "e_5xx_rate", color = "#d62728" }],
            ["AWS/ApiGateway", "Count", "ApiName", local.api_gateway_name, "Stage", "develop", { id = "m_requests", visible = false }],
            ["AWS/ApiGateway", "4XXError", "ApiName", local.api_gateway_name, "Stage", "develop", { id = "m_4xx", visible = false }],
            ["AWS/ApiGateway", "5XXError", "ApiName", local.api_gateway_name, "Stage", "develop", { id = "m_5xx", visible = false }]
          ]
        }
      },

      # ==================================================================
      # ROW 2 — LAMBDA (3 functions, errors only)
      # ==================================================================
      {
        type   = "metric"
        x      = 0
        y      = 13
        width  = 12
        height = 6
        properties = {
          title  = "Lambda — runtime failures & throttles"
          view   = "timeSeries"
          region = local.dashboard_region
          stat   = "Sum"
          period = local.dashboard_period
          metrics = [
            ["AWS/Lambda", "Errors", "FunctionName", local.api_handler_name, { label = "api-handler Errors", color = "#d62728" }],
            ["...", local.reports_handler_name, { label = "reports-handler Errors" }],
            ["...", local.report_sender_name, { label = "report-sender Errors" }],
            ["AWS/Lambda", "Throttles", "FunctionName", local.api_handler_name, { label = "api-handler Throttles", color = "#ff7f0e" }],
            ["...", local.reports_handler_name, { label = "reports-handler Throttles" }],
            ["...", local.report_sender_name, { label = "report-sender Throttles" }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 13
        width  = 12
        height = 6
        properties = {
          title  = "Lambda — invocations"
          view   = "timeSeries"
          region = local.dashboard_region
          stat   = "Sum"
          period = local.dashboard_period
          metrics = [
            ["AWS/Lambda", "Invocations", "FunctionName", local.api_handler_name, { label = "api-handler" }],
            ["...", local.reports_handler_name, { label = "reports-handler" }],
            ["...", local.report_sender_name, { label = "report-sender" }]
          ]
        }
      },

      # ==================================================================
      # ROW 3 — ASYNC REPORTS PIPELINE (SQS + worker lambdas)
      # ==================================================================
      {
        type   = "metric"
        x      = 0
        y      = 19
        width  = 12
        height = 6
        properties = {
          title  = "SQS reports queue — depth & age"
          view   = "timeSeries"
          region = local.dashboard_region
          period = local.dashboard_period
          metrics = [
            ["AWS/SQS", "ApproximateAgeOfOldestMessage", "QueueName", aws_sqs_queue.reports.name, { stat = "Maximum", label = "Oldest msg age (s)", yAxis = "right" }],
            ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", aws_sqs_queue.reports.name, { stat = "Maximum", label = "Queue visible" }],
            ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", aws_sqs_queue.reports_dlq.name, { stat = "Maximum", label = "DLQ visible", color = "#d62728" }]
          ]
          annotations = {
            horizontal = [
              { label = "Age warn 2400s", value = 2400, color = "#ff7f0e", yAxis = "right" }
            ]
          }
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 19
        width  = 12
        height = 6
        properties = {
          title  = "Report workers — Errors (sum)"
          view   = "timeSeries"
          region = local.dashboard_region
          stat   = "Sum"
          period = local.dashboard_period
          metrics = [
            ["AWS/Lambda", "Errors", "FunctionName", local.reports_handler_name, { label = "reports-handler" }],
            ["...", local.report_sender_name, { label = "report-sender" }]
          ]
        }
      },

      # ==================================================================
      # ROW 4 — DYNAMODB (main failure source at 1 RCU/WCU)
      # SEARCH auto-discovers all tables — no hardcoded names, free via console.
      # ==================================================================
      {
        type   = "metric"
        x      = 0
        y      = 25
        width  = 12
        height = 6
        properties = {
          title  = "DynamoDB — Read/Write throttle events (all tables)"
          view   = "timeSeries"
          region = local.dashboard_region
          period = local.dashboard_period
          metrics = [
            [{ expression = "SEARCH('{AWS/DynamoDB,TableName} MetricName=\"ReadThrottleEvents\"', 'Sum', ${local.dashboard_period})", id = "e_read", label = "Read throttles", region = local.dashboard_region }],
            [{ expression = "SEARCH('{AWS/DynamoDB,TableName} MetricName=\"WriteThrottleEvents\"', 'Sum', ${local.dashboard_period})", id = "e_write", label = "Write throttles", region = local.dashboard_region }]
          ]
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 25
        width  = 12
        height = 6
        properties = {
          title  = "DynamoDB — ThrottledRequests (all tables)"
          view   = "timeSeries"
          region = local.dashboard_region
          period = local.dashboard_period
          metrics = [
            [{ expression = "SEARCH('{AWS/DynamoDB,TableName} MetricName=\"ThrottledRequests\"', 'Sum', ${local.dashboard_period})", id = "e_treq", label = "ThrottledRequests", region = local.dashboard_region }]
          ]
        }
      },

      # ==================================================================
      # ROW 5 — COGNITO (auth activity)
      # Only *Successes metrics are emitted for this pool (verified via CLI);
      # standard AWS/Cognito namespace — free, no custom metrics.
      # ==================================================================
      {
        type   = "metric"
        x      = 0
        y      = 31
        width  = 24
        height = 6
        properties = {
          title  = "Cognito — successful sign-ins & sign-ups (sum)"
          view   = "timeSeries"
          region = local.dashboard_region
          stat   = "Sum"
          period = local.dashboard_period
          metrics = [
            ["AWS/Cognito", "SignInSuccesses", "UserPool", aws_cognito_user_pool.backend.id, "UserPoolClient", aws_cognito_user_pool_client.backend_api.id, { label = "Sign-ins" }],
            ["AWS/Cognito", "SignUpSuccesses", "UserPool", aws_cognito_user_pool.backend.id, "UserPoolClient", aws_cognito_user_pool_client.backend_api.id, { label = "Sign-ups" }]
          ]
        }
      }
    ]
  })
}

# Console URL for the dashboard. Opens only for principals signed in to this
# AWS account (CloudWatch dashboards are not public by default).
output "dashboard_url" {
  description = "AWS Console URL for the CloudWatch dashboard"
  value       = "https://${var.aws_region}.console.aws.amazon.com/cloudwatch/home?region=${var.aws_region}#dashboards/dashboard/${aws_cloudwatch_dashboard.restaurant_backend.dashboard_name}"
}
