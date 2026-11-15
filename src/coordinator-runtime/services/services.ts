// The services agentx has: the core ones, always on, in the order they start, and the optional ones, which a project turns on in agentx.json.

import type { Service } from "../service.js";
import { RelayService } from "./relay/relay.js";
import { SchedulerService } from "./scheduler/scheduler.js";

/** A service class, made with no arguments. */
export type ServiceClass = new () => Service;

/** The core services, by name, in the order they start. The relay starts first so that it stops last, after everything that may still send. */
export const coreServices: Record<string, ServiceClass> = { relay: RelayService, scheduler: SchedulerService };

/** The optional services, by name, each on when agentx.json lists it under `services`. */
export const optionalServices: Record<string, ServiceClass> = {};
