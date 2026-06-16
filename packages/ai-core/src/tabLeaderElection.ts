/**
 * Koordiniert mehrere Tabs — nur ein Tab soll schwere WebGPU/WebLLM-Initialisierung fahren.
 * QNBS-v3: BroadcastChannel-Leaderwahl ohne Server.
 * QNBS-v3: localStorage heartbeat for fast-path detection of alive leaders across reloads.
 */

const CHANNEL_NAME = 'worldscript-local-ai-tab-leader-v1';
const HEARTBEAT_KEY = 'worldscript-ai-leader-heartbeat';
// QNBS-v3: Heartbeat refreshed every 5s; leader considered stale after 2.4× that (12s),
//          giving enough slack for background-throttled tabs.
const HEARTBEAT_INTERVAL_MS = 5_000;
const HEARTBEAT_STALE_MS = 12_000;

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
// QNBS-v3: Track current leadership ID so surrenderLeadership() can clean up correctly.
let currentLeaderId: string | null = null;

interface HeartbeatEntry {
  id: string;
  ts: number;
}

function readHeartbeat(): HeartbeatEntry | null {
  try {
    const raw = localStorage.getItem(HEARTBEAT_KEY);
    return raw ? (JSON.parse(raw) as HeartbeatEntry) : null;
  } catch {
    return null;
  }
}

function writeHeartbeat(id: string): void {
  try {
    localStorage.setItem(HEARTBEAT_KEY, JSON.stringify({ id, ts: Date.now() }));
  } catch {
    /* localStorage unavailable (SSR / private mode) */
  }
}

function startHeartbeat(id: string): void {
  writeHeartbeat(id);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => writeHeartbeat(id), HEARTBEAT_INTERVAL_MS);
}

/** Call when inference completes so the next election isn't blocked by a stale entry. */
export function surrenderLeadership(): void {
  if (currentLeaderId === null) return;
  const stored = readHeartbeat();
  if (stored?.id === currentLeaderId) {
    try {
      localStorage.removeItem(HEARTBEAT_KEY);
    } catch {}
  }
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  currentLeaderId = null;
}

/**
 * Returns true when this tab wins the GPU-leader election.
 * Increased default timeout to 800ms for resilience on slow/throttled devices.
 */
export async function electSingleHeavyInferenceTab(timeoutMs = 800): Promise<boolean> {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    return true;
  }

  const myId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `tab-${Math.random().toString(36).slice(2)}`;

  // QNBS-v3: Fast path — if a recently alive leader exists that isn't us, skip election.
  //          Prevents slow-device tabs from repeatedly contesting leadership every inference call.
  const existing = readHeartbeat();
  if (existing && Date.now() - existing.ts < HEARTBEAT_STALE_MS && existing.id !== myId) {
    return false;
  }

  const channel = new BroadcastChannel(CHANNEL_NAME);
  const seen = new Set<string>([myId]);

  const onMessage = (ev: MessageEvent<{ kind?: string; id?: string }>) => {
    const id = ev.data?.id;
    if (ev.data?.kind === 'ping' && typeof id === 'string') {
      seen.add(id);
    }
  };

  channel.addEventListener('message', onMessage);
  channel.postMessage({ kind: 'ping', id: myId });

  return new Promise<boolean>((resolve) => {
    window.setTimeout(() => {
      channel.removeEventListener('message', onMessage);
      channel.close();
      const winner = [...seen].sort()[0];
      const isLeader = winner === myId;
      if (isLeader) {
        currentLeaderId = myId;
        startHeartbeat(myId);
      }
      resolve(isLeader);
    }, timeoutMs);
  });
}
