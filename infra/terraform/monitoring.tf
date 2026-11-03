# CloudWatch alarms + SNS notifications, using 7 of the 10 free-tier alarms:
# 3 lambda errors, 1 lambda latency, 2 SQS, 1 API Gateway 5xx.
# 
# To guarantee staying within the 10 free-tier alarms limit, DynamoDB throttle
# alarms (which previously used metric-math SEARCH) have been removed. CloudWatch
# bills SEARCH-based alarms for *each* returned metric individually. Since we have
# 13 tables, SEARCH would resolve to 13 read + 13 write = 26 metrics, breaching the
# free tier. Any actual DynamoDB throttling will cause Lambda failures and be caught
# by the critical Lambda errors alarms instead.
#
# Cost guardrail is a separate AWS Budget (see bottom) since AWS/Billing
# CloudWatch metrics require root-level account access we don't have.
#
# Monthly free-tier quotas (API GW 1M requests, SES 62k sends, DynamoDB 25 RCU/WCU
# provisioned) are not modeled as CloudWatch alarms here — CloudWatch periods don't
# align with the calendar-month billing cycle. The AWS Budget below covers this.

resource "aws_sns_topic" "cloudwatch_alerts" {
  name = "restaurant-cloudwatch-alerts-topic"
}

# Each address must confirm the subscription via the link AWS emails after apply —
# alarms silently won't reach an address until that confirmation happens.
resource "aws_sns_topic_subscription" "email" {
  for_each  = toset(var.alert_emails)
  topic_arn = aws_sns_topic.cloudwatch_alerts.arn
  protocol  = "email"
  endpoint  = each.value
}

# --- Lambda: errors are always worth paging on, regardless of function ---

resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  for_each = {
    api_handler     = local.api_handler_name
    reports_handler = local.reports_handler_name
    report_sender   = local.report_sender_name
  }

  alarm_name          = "CRITICAL-Lambda-${each.value}-Errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  alarm_description   = "Critical: ${each.value} lambda reported at least one error"
  treat_missing_data  = "notBreaching"

  dimensions    = { FunctionName = each.value }
  alarm_actions = [aws_sns_topic.cloudwatch_alerts.arn]
}

# api-handler is the only user-facing (synchronous) lambda, so it's the only one
# where p99 latency directly affects the customer experience.
resource "aws_cloudwatch_metric_alarm" "api_handler_duration_p99" {
  alarm_name          = "WARNING-Lambda-APIHandler-DurationP99"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "Duration"
  namespace           = "AWS/Lambda"
  period              = 300
  extended_statistic  = "p99"
  threshold           = 5000 # ms
  alarm_description   = "Warning: API Handler p99 duration exceeds 5000ms for 3 consecutive periods"
  treat_missing_data  = "notBreaching"

  dimensions    = { FunctionName = local.api_handler_name }
  alarm_actions = [aws_sns_topic.cloudwatch_alerts.arn]
}

# --- SQS ---

# Any message in the DLQ means a report failed all 3 retries and was dropped.
resource "aws_cloudwatch_metric_alarm" "reports_dlq_messages" {
  alarm_name          = "CRITICAL-SQS-ReportsDLQ-Messages"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 300
  statistic           = "Maximum"
  threshold           = 0
  alarm_description   = "Critical: message(s) in the reports DLQ — a report failed all retries"
  treat_missing_data  = "notBreaching"

  dimensions    = { QueueName = aws_sqs_queue.reports_dlq.name }
  alarm_actions = [aws_sns_topic.cloudwatch_alerts.arn]
}

# visibility_timeout is 600s with up to 3 retries, so a healthy message can age up
# to ~30min before landing in the DLQ. Set to 2400s (40min) to guarantee warning only
# if there is an actual stuck queue backlog, avoiding overlapping alerts with DLQ transition.
resource "aws_cloudwatch_metric_alarm" "reports_queue_oldest_message_age" {
  alarm_name          = "WARNING-SQS-ReportsQueue-OldestMessageAge"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateAgeOfOldestMessage"
  namespace           = "AWS/SQS"
  period              = 300
  statistic           = "Maximum"
  threshold           = 2400 # seconds
  alarm_description   = "Warning: reports queue backlog — oldest message older than 40min"
  treat_missing_data  = "notBreaching"

  dimensions    = { QueueName = aws_sqs_queue.reports.name }
  alarm_actions = [aws_sns_topic.cloudwatch_alerts.arn]
}

# --- API Gateway ---

resource "aws_cloudwatch_metric_alarm" "api_gateway_5xx" {
  alarm_name          = "CRITICAL-APIGateway-5XXErrors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "5XXError"
  namespace           = "AWS/ApiGateway"
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  alarm_description   = "Critical: API Gateway returned a 5XX error"
  treat_missing_data  = "notBreaching"

  dimensions = {
    ApiName = local.api_gateway_name
    Stage   = "develop"
  }
  alarm_actions = [aws_sns_topic.cloudwatch_alerts.arn]
}

# --- Billing safety net ---
# AWS/Billing CloudWatch metrics require "Receive Billing Alerts" to be enabled by
# the account root user — not available to an IAM role, even with admin rights.
# AWS Budgets has no such restriction (it's IAM-permission based, not root-gated),
# so it's the only viable free-tier cost guardrail here.
resource "aws_budgets_budget" "monthly_cost" {
  name         = "restaurant-backend-monthly-cost"
  budget_type  = "COST"
  limit_amount = "5"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = var.alert_emails
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = var.alert_emails
  }
}
