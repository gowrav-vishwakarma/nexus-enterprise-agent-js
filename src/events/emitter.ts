import type { NexusEvent } from "./models.js";
import { eventToDict } from "./models.js";

export abstract class EventSink {
  abstract emit(event: NexusEvent): Promise<void>;
}

export class StdoutEventSink extends EventSink {
  async emit(event: NexusEvent): Promise<void> {
    console.log(`[${event.timestamp}] [${event.eventType}] ${JSON.stringify(eventToDict(event))}`);
  }
}

export class CustomCallbackSink extends EventSink {
  constructor(private readonly callback: (event: NexusEvent) => Promise<void>) {
    super();
  }

  async emit(event: NexusEvent): Promise<void> {
    try {
      await this.callback(event);
    } catch (error) {
      console.error("Error in custom callback event sink:", error);
    }
  }
}

export class NexusEventEmitter {
  private readonly sinks: EventSink[] = [];

  registerSink(sink: EventSink): void {
    if (!this.sinks.includes(sink)) {
      this.sinks.push(sink);
    }
  }

  unregisterSink(sink: EventSink): void {
    const index = this.sinks.indexOf(sink);
    if (index >= 0) {
      this.sinks.splice(index, 1);
    }
  }

  async emit(event: NexusEvent): Promise<void> {
    for (const sink of this.sinks) {
      try {
        await sink.emit(event);
      } catch (error) {
        console.error(`Error emitting event ${event.eventId} to sink ${sink.constructor.name}:`, error);
      }
    }
  }
}
