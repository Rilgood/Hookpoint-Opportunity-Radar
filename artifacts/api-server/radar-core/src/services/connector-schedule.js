import { nowIso } from '../lib.js';

/**
 * Connector status stored when the scheduler ran a cadence and the saved
 * schedule input was rejected (a validation-style 4xx). It persists until the
 * next successful run, a manual run starts, or the connector is re-enabled,
 * so operators can see why the cadence is waiting instead of finding out an
 * hour later from a failed run.
 */
export const SCHEDULE_REJECTED_STATUS = 'schedule_rejected';

const cadenceLabels = { hourly: 'hourly', realtime: 'hourly', daily: 'daily', weekly: 'weekly', monthly: 'monthly', quarterly: 'quarterly' };

/**
 * Explains, for an operator, whether a connector's cadence is going to run and
 * why not when it will not. The result is derived from the persisted
 * connector row plus the `implemented` flag; it holds no new state.
 *
 * `will_run` is true only for states where the scheduler will pick the
 * connector up without any human action (`waiting`, `due`, `backoff`, `running`).
 * `due` deliberately carries no future timestamp: the scheduler only ticks
 * while a service instance is awake, so on autoscale the honest answer is
 * "the next time the service is active", not a stale `next_run_at`.
 */
export function describeConnectorSchedule(connector, now = nowIso()) {
  const base = {
    next_run_at: connector.next_run_at ?? null,
    backoff_until: connector.backoff_until ?? null,
    consecutive_failures: Number(connector.consecutive_failures || 0),
  };
  const done = (state, reason, extra = {}) => ({ state, reason, will_run: false, ...base, ...extra });
  const cadence = cadenceLabels[connector.cadence] || connector.cadence;

  if (connector.mode === 'push') return done('push', `${connector.label} receives data through its webhook endpoint; there is no pull schedule.`);
  if (connector.implemented === false) return done('adapter_pending', `${connector.label} has a registered contract but its adapter is not implemented yet.`);
  if (!connector.configured) return done('needs_configuration', 'Waiting for an administrator to provide the required server-side configuration.');
  if (!connector.enabled) return done('disabled', 'Disabled. Enable the connector to schedule it.');
  if (connector.status === 'running') return done('running', 'A run is in progress.', { will_run: true });
  if (base.backoff_until && base.backoff_until > now) {
    const failures = base.consecutive_failures;
    return done('backoff', `Paused after ${failures} consecutive failure${failures === 1 ? '' : 's'}; retries automatically after ${base.backoff_until}.`, { will_run: true });
  }
  if (connector.status === SCHEDULE_REJECTED_STATUS) {
    const detail = connector.last_error ? ` (${connector.last_error})` : '';
    return done('input_rejected', `The saved schedule input was rejected${detail}. Fix it under Configure; the ${cadence} cadence will try again at ${base.next_run_at ?? 'its next slot'}.`);
  }
  if (connector.cadence === 'manual') return done('manual', 'Runs only when triggered manually.');
  if (!base.next_run_at || base.next_run_at <= now) {
    const retry = base.consecutive_failures ? ` after ${base.consecutive_failures} consecutive failure${base.consecutive_failures === 1 ? '' : 's'}` : '';
    return done('due', `Due now${retry}; runs on the next scheduler tick while the service is active.`, { will_run: true });
  }
  return done('waiting', `Waiting for its ${cadence} cadence; next run at ${base.next_run_at}.`, { will_run: true });
}

/** Whether a stored connector run was started by the scheduler, a person, or predates the trigger flag. */
export function runTrigger(metadata) {
  const trigger = metadata?.trigger;
  return trigger === 'scheduled' || trigger === 'manual' ? trigger : null;
}
