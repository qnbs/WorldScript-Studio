/**
 * Koordiniert mehrere Tabs — nur ein Tab soll schwere WebGPU/WebLLM-Initialisierung fahren.
 * QNBS-v3: BroadcastChannel-Leaderwahl ohne Server.
 */

const CHANNEL_NAME = 'storycraft-local-ai-tab-leader-v1';

/** Etwas Luft für langsame Geräte/Schedulers — zu kurz ⇒ Follower-Tab ohne Grund. */
export async function electSingleHeavyInferenceTab(timeoutMs = 280): Promise<boolean> {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    return true;
  }

  const myId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `tab-${Math.random().toString(36).slice(2)}`;

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
      resolve(winner === myId);
    }, timeoutMs);
  });
}
