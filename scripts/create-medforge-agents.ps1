param(
  [string]$TrueForgeUrl = "http://localhost:8790",
  [string]$ModelName = "openai/gpt-5-4-mini",
  [string]$ProviderModelId = "gpt-5.4-mini",
  [string]$ProviderModelName = "gpt-5-4-mini"
)

$ErrorActionPreference = "Stop"

function Import-DotEnv {
  param([string]$Path = ".env")

  if (-not (Test-Path $Path)) {
    return
  }

  Get-Content $Path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) {
      return
    }

    $parts = $line -split "=", 2
    if ($parts.Count -ne 2) {
      return
    }

    $name = $parts[0].Trim()
    $value = $parts[1].Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    [Environment]::SetEnvironmentVariable($name, $value, "Process")
  }
}

Import-DotEnv

if (-not $env:OPENAI_API_KEY) {
  throw "OPENAI_API_KEY is not set. Add OPENAI_API_KEY=sk-... to .env or run: `$env:OPENAI_API_KEY='sk-...'"
}

function Invoke-TrueForgeJson {
  param(
    [string]$Method,
    [string]$Path,
    [object]$Body = $null
  )

  $uri = "$TrueForgeUrl$Path"
  if ($null -eq $Body) {
    return Invoke-RestMethod -Method $Method -Uri $uri
  }

  # PowerShell ConvertTo-Json collapses single-element arrays (mcp_servers).
  # Serialize mcp_servers as a forced JSON array when present.
  $payload = $Body
  if ($Body.manifest -and $Body.manifest.mcp_servers) {
    $mcp = @($Body.manifest.mcp_servers)
    $mcpJson = "[" + (($mcp | ForEach-Object { $_ | ConvertTo-Json -Depth 40 -Compress }) -join ",") + "]"
    $clone = @{
      name = $Body.name
      description = $Body.description
      manifest = @{}
    }
    foreach ($key in $Body.manifest.Keys) {
      if ($key -eq "mcp_servers") { continue }
      $clone.manifest[$key] = $Body.manifest[$key]
    }
    $base = $clone | ConvertTo-Json -Depth 50 -Compress
    $json = $base.TrimEnd("}") + ",""mcp_servers"":" + $mcpJson + "}"
    return Invoke-RestMethod -Method $Method -Uri $uri -ContentType "application/json" -Body $json
  }

  $json = $Body | ConvertTo-Json -Depth 50
  return Invoke-RestMethod -Method $Method -Uri $uri -ContentType "application/json" -Body $json
}

Write-Host "Checking TrueForge at $TrueForgeUrl ..."
$capabilities = Invoke-TrueForgeJson -Method Get -Path "/api/v1/capabilities"
Write-Host "TrueForge capabilities loaded."

$providerBody = @{
  manifest = @{
    type = "openai"
    auth = @{
      api_key = $env:OPENAI_API_KEY
    }
    models = @(
      @{
        model_id = $ProviderModelId
        name = $ProviderModelName
        properties = @{
          context_length = 400000
          max_output_tokens = 128000
          reasoning_efforts = @("none", "low", "medium", "high", "xhigh")
        }
      }
    )
  }
}

Write-Host "Configuring OpenAI model provider ..."
try {
  Invoke-TrueForgeJson -Method Post -Path "/api/v1/settings/model-providers" -Body $providerBody | Out-Null
} catch {
  Write-Host "Provider create failed; trying replace instead."
  Invoke-TrueForgeJson -Method Put -Path "/api/v1/settings/model-providers" -Body $providerBody | Out-Null
}

$mcpServerName = "medforge-tools"
$mcpServerUrl = if ($env:MEDFORGE_MCP_URL) { $env:MEDFORGE_MCP_URL } else { "http://localhost:3000/mcp" }

Write-Host "Registering MedForge MCP server at $mcpServerUrl ..."
$mcpBody = @{
  manifest = @{
    type = "remote"
    name = $mcpServerName
    url = $mcpServerUrl
    description = "MedForge investigator tools: adherence history, live drug-risk lookup, mock refill status, and wellness transcript analysis."
  }
}
try {
  Invoke-TrueForgeJson -Method Post -Path "/api/v1/settings/mcp-servers" -Body $mcpBody | Out-Null
} catch {
  Write-Host "MCP create failed; trying replace instead."
  Invoke-TrueForgeJson -Method Put -Path "/api/v1/settings/mcp-servers" -Body $mcpBody | Out-Null
}

$investigatorConfig = @{
  iteration_limit = 20
  sandbox = @{
    enabled = $false
  }
  dynamic_sub_agents = @{
    enabled = $false
  }
  generative_ui = @{
    enabled = $true
  }
  ask_user_questions = @{
    enabled = $false
  }
  web_search = @{
    enabled = $false
  }
}

$baseConfig = @{
  iteration_limit = 20
  sandbox = @{
    enabled = $false
  }
  dynamic_sub_agents = @{
    enabled = $true
  }
  generative_ui = @{
    enabled = $true
  }
  web_search = @{
    enabled = $false
  }
}

$jsonFormat = @{
  type = "json_object"
}

function New-MedforgeMcpBinding {
  param(
    [string[]]$Tools,
    [string[]]$ApprovalTools = @()
  )

  $enabled = @($Tools) + @("memory_get", "memory_put", "get_skill")

  return @(
    @{
      name = $mcpServerName
      enable_tools = $enabled
      preload = $true
      preload_tools = $enabled
      require_approval_for_tools = $ApprovalTools
    }
  )
}

$agents = @(
  @{
    name = "medforge-orchestrator"
    description = "MedForge Orchestrator: owns missed-dose sessions and fans out to investigator agents."
    instructions = @"
You are the MedForge Orchestrator.

Role:
- Own each missed-dose safety session.
- Trigger Schedule, Clinical Risk, Pharmacy, and Wellness investigators.
- Return a structured session handoff for correlation.

Safety:
- Never execute calls, texts, alerts, or dismissals.
- Every real-world action requires the Human Approval Gate.
- Clearly mark mocked evidence versus real/public evidence.

Return JSON with: session_id, patient, medication, trigger, requested_investigators, safety_constraints.
"@
  },
  @{
    name = "medforge-schedule-investigator"
    description = "Detects adherence patterns such as repeated misses in a 7-day window."
    config = $investigatorConfig
    mcp_servers = New-MedforgeMcpBinding -Tools @("get_adherence_history")
    instructions = @"
You are the MedForge Schedule Investigator.

Before classifying: call get_skill name=schedule-adherence, memory_get key=patient:{patient_id}, then get_adherence_history.
Do not invent missed-dose history. memory_put your JSON under session:{session_id}:schedule when session_id is provided.

Pattern rule: 2 or more missed doses in 7 days for the same medication is escalation-worthy.

Return JSON with: agent, status, severity, confidence, score, summary, evidence, recommended_action.
"@
  },
  @{
    name = "medforge-clinical-risk-investigator"
    description = "Classifies medication skip severity and prepares OpenFDA/RxNav evidence handoff."
    config = $investigatorConfig
    mcp_servers = New-MedforgeMcpBinding -Tools @("lookup_drug_risk")
    instructions = @"
You are the MedForge Clinical Risk Investigator.

Before classifying: get_skill name=clinical-skip-risk, then lookup_drug_risk. memory_put result when session_id is provided.
Do not invent RxNav or openFDA results.

Return JSON with: agent, status, severity, confidence, score, summary, evidence, recommended_action.
"@
  },
  @{
    name = "medforge-pharmacy-investigator"
    description = "Checks whether refill status may explain the missed dose."
    config = $investigatorConfig
    mcp_servers = New-MedforgeMcpBinding -Tools @("get_refill_status")
    instructions = @"
You are the MedForge Pharmacy Investigator.

Before classifying: get_skill name=pharmacy-refill, then get_refill_status. Label mock pharmacy data clearly.

Return JSON with: agent, status, severity, confidence, score, summary, evidence, recommended_action.
"@
  },
  @{
    name = "medforge-wellness-investigator"
    description = "Interprets voice-check-in transcript for confusion, distress, or unreachable signals."
    config = $investigatorConfig
    mcp_servers = New-MedforgeMcpBinding -Tools @("analyze_wellness_text")
    instructions = @"
You are the MedForge Wellness Investigator.

Before classifying: get_skill name=wellness-distress, then analyze_wellness_text. Do not invent symptoms.

Return JSON with: agent, status, severity, confidence, score, summary, evidence, recommended_action.
"@
  },
  @{
    name = "medforge-correlation-agent"
    description = "Fans in investigator outputs and produces one risk score plus plain-language narrative."
    instructions = @"
You are the MedForge Correlation Agent.

Combine Schedule, Clinical Risk, Pharmacy, and Wellness investigator JSON.
Produce one risk score from 0 to 100, severity, evidence count, and a plain-language narrative.
Do not execute escalation. Recommend review when the evidence merits it.

Return JSON with: agent, status, risk_score, severity, title, narrative, approval_required, evidence_count.
"@
  },
  @{
    name = "medforge-escalation-agent"
    description = "Executes only human-approved actions and writes audit-ready records."
    config = $investigatorConfig
    mcp_servers = New-MedforgeMcpBinding -Tools @("place_caregiver_call", "send_caregiver_sms") -ApprovalTools @("place_caregiver_call", "send_caregiver_sms")
    instructions = @"
You are the MedForge Escalation Agent.

Only act after the user provides an approved action: call, alert, or dismiss.
Never infer approval from evidence alone.
Call get_skill name=escalation-human-gate first.

When approved_action is call: call place_caregiver_call with approved_action=call and a short spoken message.
When approved_action is alert: call send_caregiver_sms with approved_action=alert and an SMS body.
For dismiss: produce an audit-ready JSON record without calling Twilio.

Return JSON with: agent, status, approved_action, actor, result, audit_record.
"@
  },
  @{
    name = "medforge-conversation-agent"
    description = "Live phone conversation agent: interprets elder speech after a medication reminder and decides escalate vs calm close."
    config = $investigatorConfig
    mcp_servers = New-MedforgeMcpBinding -Tools @()
    instructions = @"
You are the MedForge Conversation Agent on a live Twilio reminder call.

Before deciding: call get_skill name=elder-conversation, then memory_get key=patient:{patient_id}.
Classify elder speech as confirmed, distress, unclear, or no_input.
memory_put your JSON decision under session:{session_id}:conversation-decision.

Rules:
- Critical med + distress (dizzy, unwell, help, fall, confused) → escalate_caregiver true
- confirmed took medicine / feeling fine → escalate_caregiver false
- Keep spoken_reply_to_elder under 25 words

Return JSON only with: intent, spoken_reply_to_elder, escalate_caregiver, caregiver_message, reason, confidence.
"@
  }
)

foreach ($agent in $agents) {
  $manifest = @{
    model = @{
      name = $ModelName
      params = @{
        temperature = 0.2
        reasoning_effort = "medium"
      }
    }
    instructions = $agent.instructions
    response_format = $jsonFormat
    config = if ($agent.config) { $agent.config } else { $baseConfig }
  }
  if ($agent.mcp_servers) {
    $manifest.mcp_servers = $agent.mcp_servers
  }

  $body = @{
    name = $agent.name
    description = $agent.description
    manifest = $manifest
  }

  Write-Host "Creating $($agent.name) ..."
  try {
    Invoke-TrueForgeJson -Method Post -Path "/api/v1/agents" -Body $body | Out-Null
  } catch {
    Write-Host "Create failed for $($agent.name); trying update."
    $existing = Invoke-TrueForgeJson -Method Get -Path "/api/v1/agents"
    $match = $existing.data | Where-Object { $_.name -eq $agent.name } | Select-Object -First 1
    if (-not $match) {
      throw
    }

    $updateBody = @{
      description = $agent.description
      manifest = $body.manifest
    }
    Invoke-TrueForgeJson -Method Put -Path "/api/v1/agents/$($match.id)" -Body $updateBody | Out-Null
  }
}

Write-Host "MedForge agents registered:"
(Invoke-TrueForgeJson -Method Get -Path "/api/v1/agents").data | Select-Object name, description | Format-Table -AutoSize

Write-Host "Ensuring TrueForge morning schedule for schedule investigator ..."
try {
  $scheduleBody = @{
    name = "eleanor-apixaban-morning-check"
    agent_name = "medforge-schedule-investigator"
    manifest = @{
      cron = "0 8 * * *"
      timezone = "America/New_York"
      status = "active"
      task = "Patient eleanor / apixaban morning check. Call get_skill schedule-adherence, memory_get patient:eleanor, get_adherence_history, memory_put schedule:latest, return investigator JSON."
    }
  }
  try {
    Invoke-TrueForgeJson -Method Post -Path "/api/v1/schedules" -Body $scheduleBody | Out-Null
  } catch {
    $existing = Invoke-TrueForgeJson -Method Get -Path "/api/v1/schedules"
    $match = $existing.data | Where-Object { $_.name -eq "eleanor-apixaban-morning-check" } | Select-Object -First 1
    if ($match) {
      Invoke-TrueForgeJson -Method Put -Path "/api/v1/schedules/$($match.id)" -Body @{
        name = $scheduleBody.name
        manifest = $scheduleBody.manifest
      } | Out-Null
    } else {
      throw
    }
  }
  Write-Host "Schedule ready: eleanor-apixaban-morning-check (daily 08:00 America/New_York)"
} catch {
  Write-Host "Schedule setup skipped: $($_.Exception.Message)"
}
