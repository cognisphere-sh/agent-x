#!/usr/bin/env bash
# The project's own checks. agentx dev, and agentx server start and restart, run this file with bash in the project's root before they start
# anything; a non-zero exit stops them. agentx itself checks each agent's model login and keys, and the secrets of its services: check here what
# only this project needs, such as a key that one of its extensions reads. For example:
#
# has() { [ -n "${!2:-}" ] || grep -q "^$2=." "$1" 2> /dev/null; }
# has agent-x/agents/main/.env MY_API_KEY || echo "Warning: MY_API_KEY is not set in agent-x/agents/main/.env: main cannot reach My API." >&2
