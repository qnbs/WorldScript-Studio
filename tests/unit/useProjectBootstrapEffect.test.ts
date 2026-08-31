// QNBS-v3: locks in the new isInitialLoad guard invariant on shouldRunProjectBootstrap/useProjectBootstrapEffect — proves the guard logic, not a live reproduction of the React effect-ordering race itself (that evidence is the CI runs, documented in the tracking issue).
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dispatch = vi.fn();
vi.mock('../../app/hooks', () => ({
  useAppDispatch: () => dispatch,
}));

import { projectActions } from '../../features/project/projectSlice';
import {
  shouldRunProjectBootstrap,
  useProjectBootstrapEffect,
} from '../../hooks/useProjectBootstrapEffect';

const blankProject = { title: '', logline: '', manuscript: [] };
const t = (key: string) => key;

beforeEach(() => {
  dispatch.mockClear();
});

describe('shouldRunProjectBootstrap', () => {
  it('blocks during the exact race window: isInitialLoad still true, isPortalActive stale-false', () => {
    // This is the reproduced race: on the first commit, useApp's mount effect has scheduled
    // isPortalActive=true but it has not landed yet — isInitialLoad, set in the SAME batched
    // update, is the reliable signal that the bootstrap decision has not settled.
    expect(
      shouldRunProjectBootstrap({
        project: blankProject,
        isNewUser: false,
        isInitialLoad: true,
        isPortalActive: false,
        isI18nReady: true,
      }),
    ).toBe(false);
  });

  it('allows once bootstrap has settled and the portal is not active', () => {
    expect(
      shouldRunProjectBootstrap({
        project: blankProject,
        isNewUser: false,
        isInitialLoad: false,
        isPortalActive: false,
        isI18nReady: true,
      }),
    ).toBe(true);
  });

  it('blocks while the portal is active, even after bootstrap settles', () => {
    expect(
      shouldRunProjectBootstrap({
        project: blankProject,
        isNewUser: false,
        isInitialLoad: false,
        isPortalActive: true,
        isI18nReady: true,
      }),
    ).toBe(false);
  });

  it('blocks while i18n is not ready', () => {
    expect(
      shouldRunProjectBootstrap({
        project: blankProject,
        isNewUser: false,
        isInitialLoad: false,
        isPortalActive: false,
        isI18nReady: false,
      }),
    ).toBe(false);
  });

  it('blocks when there is no project yet', () => {
    expect(
      shouldRunProjectBootstrap({
        project: null,
        isNewUser: false,
        isInitialLoad: false,
        isPortalActive: false,
        isI18nReady: true,
      }),
    ).toBe(false);
  });
});

describe('useProjectBootstrapEffect', () => {
  it('never dispatches during the race window (isInitialLoad still true)', () => {
    renderHook(() =>
      useProjectBootstrapEffect({
        project: blankProject,
        isNewUser: false,
        isInitialLoad: true,
        isPortalActive: false,
        isI18nReady: true,
        t,
      }),
    );
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('preserves blank metadata for a returning project while still seeding its empty manuscript', () => {
    renderHook(() =>
      useProjectBootstrapEffect({
        project: blankProject,
        isNewUser: false,
        isInitialLoad: false,
        isPortalActive: false,
        isI18nReady: true,
        t,
      }),
    );
    expect(dispatch).not.toHaveBeenCalledWith(projectActions.updateTitle(expect.anything()));
    expect(dispatch).not.toHaveBeenCalledWith(projectActions.updateLogline(expect.anything()));
    expect(dispatch).toHaveBeenCalledWith(
      projectActions.setManuscript([
        expect.objectContaining({ title: 'initialProject.chapter1', content: '' }),
      ]),
    );
  });

  it('seeds blank metadata only once for a fresh user', () => {
    const { rerender } = renderHook(
      ({ project }) =>
        useProjectBootstrapEffect({
          project,
          isNewUser: true,
          isInitialLoad: false,
          isPortalActive: false,
          isI18nReady: true,
          t,
        }),
      { initialProps: { project: blankProject } },
    );
    expect(dispatch).toHaveBeenCalledWith(projectActions.updateTitle('initialProject.title'));
    expect(dispatch).toHaveBeenCalledWith(projectActions.updateLogline('initialProject.logline'));

    dispatch.mockClear();
    rerender({ project: { ...blankProject } });
    expect(dispatch).not.toHaveBeenCalledWith(projectActions.updateTitle(expect.anything()));
    expect(dispatch).not.toHaveBeenCalledWith(projectActions.updateLogline(expect.anything()));
  });

  it('dispatches nothing for a project that already has real content', () => {
    renderHook(() =>
      useProjectBootstrapEffect({
        project: {
          title: 'My Real Story',
          logline: 'A real logline',
          manuscript: [{ id: 'sec-1', title: 'Ch1', content: 'Real content' }],
        },
        isNewUser: false,
        isInitialLoad: false,
        isPortalActive: false,
        isI18nReady: true,
        t,
      }),
    );
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('does not dispatch anything while the portal is active', () => {
    renderHook(() =>
      useProjectBootstrapEffect({
        project: blankProject,
        isNewUser: false,
        isInitialLoad: false,
        isPortalActive: true,
        isI18nReady: true,
        t,
      }),
    );
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('does not dispatch anything before a project has loaded', () => {
    renderHook(() =>
      useProjectBootstrapEffect({
        project: null,
        isNewUser: false,
        isInitialLoad: false,
        isPortalActive: false,
        isI18nReady: true,
        t,
      }),
    );
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('repairs only the fields that actually need it, leaving already-valid fields alone', () => {
    renderHook(() =>
      useProjectBootstrapEffect({
        project: {
          title: 'initialProject.title',
          logline: 'A real logline',
          manuscript: [{ id: 'sec-1', title: 'Real Chapter', content: 'real' }],
        },
        isNewUser: false,
        isInitialLoad: false,
        isPortalActive: false,
        isI18nReady: true,
        t,
      }),
    );
    expect(dispatch).toHaveBeenCalledWith(projectActions.updateTitle('initialProject.title'));
    expect(dispatch).not.toHaveBeenCalledWith(projectActions.updateLogline(expect.anything()));
    expect(dispatch).not.toHaveBeenCalledWith(projectActions.setManuscript(expect.anything()));
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('repairs only the logline when the title is already valid', () => {
    renderHook(() =>
      useProjectBootstrapEffect({
        project: {
          title: 'A Real Title',
          logline: 'initialProject.logline',
          manuscript: [{ id: 'sec-1', title: 'Real Chapter', content: 'real' }],
        },
        isNewUser: false,
        isInitialLoad: false,
        isPortalActive: false,
        isI18nReady: true,
        t,
      }),
    );
    expect(dispatch).not.toHaveBeenCalledWith(projectActions.updateTitle(expect.anything()));
    expect(dispatch).toHaveBeenCalledWith(projectActions.updateLogline('initialProject.logline'));
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
