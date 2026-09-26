/**
 * A stored project exists but cannot be brought into the editor (#553 a9). Startup stops here: a
 * blank project booted in its place would gain write authority and its first save could replace the
 * stored one, so nothing is loaded and nothing is written until the stored project is readable.
 */
export class PersistedProjectNotLoadableError extends Error {
  readonly code = 'PERSISTED_PROJECT_NOT_LOADABLE';

  constructor() {
    super('The saved project could not be loaded into the editor. It has not been changed.');
    this.name = 'PersistedProjectNotLoadableError';
  }
}
