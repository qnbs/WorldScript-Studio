import { configureStore } from '@reduxjs/toolkit';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appStoreRef } from '../../../app/storeRef';
import { WebSpeechConsentHost } from '../../../components/voice/WebSpeechConsentHost';
import settingsReducer, { settingsActions } from '../../../features/settings/settingsSlice';
import { ensureWebSpeechConsent } from '../../../services/voice/webSpeechConsent';

vi.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key, language: 'en' }),
}));

function renderHost() {
  const store = configureStore({ reducer: { settings: settingsReducer } });
  appStoreRef.current = store as unknown as typeof appStoreRef.current;
  const view = render(
    <Provider store={store}>
      <WebSpeechConsentHost />
    </Provider>,
  );
  return { store, view };
}

afterEach(() => {
  appStoreRef.current = null;
});

// #1261: the consent dialog had no importer, so no start could ask and no UI path could grant consent.
describe('WebSpeechConsentHost', () => {
  it('asks once for concurrent starts and grants both after the user agrees', async () => {
    const { store } = renderHost();
    let first: Promise<boolean> = Promise.resolve(false);
    let second: Promise<boolean> = Promise.resolve(false);
    act(() => {
      first = ensureWebSpeechConsent();
      second = ensureWebSpeechConsent();
    });
    expect(await screen.findAllByText('settings.voice.privacy.consentTitle')).toHaveLength(1);

    await userEvent.setup().click(screen.getByText('settings.voice.privacy.consentAcknowledge'));

    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(store.getState().settings.voice?.webSpeechConsentGranted).toBe(true);
    expect(screen.queryByText('settings.voice.privacy.consentTitle')).toBeNull();
  });

  it('opens above the command palette, whose microphone can ask for consent', async () => {
    renderHost();
    act(() => {
      void ensureWebSpeechConsent();
    });
    const title = await screen.findByText('settings.voice.privacy.consentTitle');
    // components/CommandPalette.tsx renders its full-screen layer at z-[100].
    expect(title.closest('.fixed')?.className).toContain('z-[110]');
  });

  it('declining refuses the start and keeps the stored engine choice', async () => {
    const { store } = renderHost();
    act(() => {
      store.dispatch(settingsActions.setVoiceSettings({ sttEngine: 'whisper' }));
    });
    let answer: Promise<boolean> = Promise.resolve(true);
    act(() => {
      answer = ensureWebSpeechConsent();
    });

    await userEvent.setup().click(await screen.findByText('settings.voice.privacy.consentDecline'));

    await expect(answer).resolves.toBe(false);
    expect(store.getState().settings.voice?.webSpeechConsentGranted).toBe(false);
    expect(store.getState().settings.voice?.sttEngine).toBe('whisper');
  });

  it('a stored consent starts without showing the dialog', async () => {
    const { store } = renderHost();
    act(() => {
      store.dispatch(settingsActions.setVoiceSettings({ webSpeechConsentGranted: true }));
    });
    await expect(ensureWebSpeechConsent()).resolves.toBe(true);
    expect(screen.queryByText('settings.voice.privacy.consentTitle')).toBeNull();
  });

  it('unmounting while the dialog is open declines, and later starts cannot ask', async () => {
    const { view } = renderHost();
    let answer: Promise<boolean> = Promise.resolve(true);
    act(() => {
      answer = ensureWebSpeechConsent();
    });
    await screen.findByText('settings.voice.privacy.consentTitle');

    view.unmount();

    await expect(answer).resolves.toBe(false);
    await expect(ensureWebSpeechConsent()).resolves.toBe(false);
  });
});
