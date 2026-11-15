# Coordinator runtime

The process `agentx serve` runs: every agent of a project, delivery of what agents send, schedules, and `/health` and `/agents`. `deliver-event.ts` holds the code that writes an agent's inbox, for the coordinator and a person's `agentx event deliver`. See [docs/architecture/coordinator-runtime/](../../docs/architecture/coordinator-runtime/README.md).
