# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO

variable "domain" {
  type        = string
  description = "FQDN served by Caddy (e.g., canary.cognidao.org)"
}

variable "app_image" {
  type        = string
  description = "Docker image to deploy (e.g., ghcr.io/cogni-dao/cogni-template:production-abc123)"
}

variable "host" {
  type        = string
  description = "Public IP or DNS of the VM to deploy to"
}

variable "ssh_user" {
  type        = string
  description = "SSH user for connecting to the VM"
  default     = "root"
}

variable "ssh_private_key" {
  type        = string
  description = "SSH private key in PEM format (injected by CI)"
  sensitive   = true
}

variable "litellm_master_key" {
  type        = string
  description = "LiteLLM master key for authentication"
  sensitive   = true
}

variable "openrouter_api_key" {
  type        = string
  description = "OpenRouter API key for LLM access"
  sensitive   = true
}

variable "litellm_port" {
  type        = number
  description = "Port for LiteLLM service"
  default     = 4000
}

variable "litellm_host" {
  type        = string
  description = "Host for LiteLLM service"
  default     = "127.0.0.1"
}