const { EventEmitter } = require('events');

const MAX_EVENTS = 2000;

const DEFAULT_EVENT_SCHEMA = {
  DOWNLOAD_COMPLETE: ['service', 'path'],
  FILE_MOVED: ['from', 'to'],
  SERVICE_DOWN: ['service', 'reason'],
  SERVICE_RECOVERED: ['service'],
  WORKFLOW_STARTED: ['workflowKey', 'runId'],
  WORKFLOW_STEP_FAILED: ['workflowKey', 'runId', 'stepKey', 'error'],
};

const createEventBus = ({
  maxEvents = MAX_EVENTS,
  now = () => Date.now(),
  schema = DEFAULT_EVENT_SCHEMA,
} = {}) => {
  const emitter = new EventEmitter();
  const events = [];

  const normalizeEventName = (eventName) => String(eventName || '').trim() || 'UNKNOWN_EVENT';

  const validatePayload = (eventName, payload) => {
    const requiredFields = schema[eventName];
    if (!Array.isArray(requiredFields) || requiredFields.length === 0) {
      return true;
    }
    if (!payload || typeof payload !== 'object') {
      return false;
    }
    return requiredFields.every((field) => Object.prototype.hasOwnProperty.call(payload, field));
  };

  const emit = (eventName, payload = {}) => {
    const normalizedEvent = normalizeEventName(eventName);
    const timestamp = new Date(now()).toISOString();
    const schemaValid = validatePayload(normalizedEvent, payload);
    const event = {
      event: normalizedEvent,
      payload: payload && typeof payload === 'object' ? { ...payload } : {},
      schemaValid,
      timestamp,
    };

    events.push(event);
    if (events.length > maxEvents) {
      events.splice(0, events.length - maxEvents);
    }

    emitter.emit(normalizedEvent, event);
    emitter.emit('*', event);

    return event;
  };

  const on = (eventName, handler) => {
    const name = normalizeEventName(eventName);
    if (typeof handler !== 'function') {
      return () => {};
    }

    emitter.on(name, handler);
    return () => {
      emitter.off(name, handler);
    };
  };

  const once = (eventName, handler) => {
    const name = normalizeEventName(eventName);
    if (typeof handler !== 'function') {
      return () => {};
    }

    emitter.once(name, handler);
    return () => {
      emitter.off(name, handler);
    };
  };

  const listEvents = ({ limit = 200, since } = {}) => {
    const normalizedLimit = Math.min(2000, Math.max(1, Number(limit) || 200));
    const sinceMs = Number.isFinite(Number(since)) ? Number(since) : null;
    const filtered = sinceMs === null
      ? events
      : events.filter((entry) => Date.parse(entry.timestamp) >= sinceMs);
    return filtered.slice(-normalizedLimit).map((entry) => ({ ...entry }));
  };

  return {
    emit,
    listEvents,
    on,
    once,
    schema: { ...schema },
  };
};

module.exports = {
  createEventBus,
  DEFAULT_EVENT_SCHEMA,
};
