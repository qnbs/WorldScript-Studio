import type { Template } from './types';

export const ICONS = {
  DASHBOARD: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75c0 .621-.504 1.125-1.125 1.125h-2.25A1.125 1.125 0 013 20.875v-7.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"
    />
  ),
  TEMPLATES: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
    />
  ),
  OUTLINE: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
    />
  ),
  CHARACTERS: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
    />
  ),
  WORLD: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12.75 3.03v.568c0 .334.148.65.405.864l1.068.89c.442.369.535 1.024.217 1.463l-.67.89a1.125 1.125 0 01-1.628.16l-1.068-.89a.453.453 0 00-.405-.082l-.67.448 1.125.864a1.125 1.125 0 010 1.848l-1.125.864-.67.448a.453.453 0 00-.405-.082l-1.068-.89a1.125 1.125 0 01-.16-1.628l.89-.67c.44-.32.536-1.024-.217-1.463l-.89-1.068a.453.453 0 00-.864-.405l-.568.254v.568c0 .334-.148.65-.405.864l-1.068.89c-.442.369-.535 1.024-.217 1.463l.67.89a1.125 1.125 0 011.628.16l1.068-.89a.453.453 0 00.405.082l.67-.448-1.125-.864a1.125 1.125 0 010-1.848l1.125.864.67-.448a.453.453 0 00.405.082l1.068.89a1.125 1.125 0 01.16 1.628l-.89.67c-.44.32-.536-1.024-.217-1.463l.89 1.068a.453.453 0 00.864.405l.568-.254V12a1.125 1.125 0 011.125-1.125h2.252c.414 0 .75.336.75.75l.01 6a.75.75 0 01-.75.75h-2.252a1.125 1.125 0 01-1.125-1.125V3.03zM6.375 21v-3.03c0-.334.148-.65.405-.864l1.068-.89c.442-.369.535-1.024.217-1.463l-.67-.89a1.125 1.125 0 01-1.628-.16l-1.068.89a.453.453 0 00-.405.082l-.67.448 1.125.864a1.125 1.125 0 010 1.848l-1.125.864-.67.448a.453.453 0 00-.405.082l-1.068-.89a1.125 1.125 0 01-.16-1.628l.89-.67c.44-.32.536-1.024-.217-1.463l-.89-1.068a.453.453 0 00-.864-.405l-.568.254V18a1.125 1.125 0 01-1.125 1.125H.752a.75.75 0 01-.75-.75l-.01-6a.75.75 0 01.75-.75h2.252a1.125 1.125 0 011.125 1.125v12.97z"
    />
  ),
  WRITER: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10"
    />
  ),
  EXPORT: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
    />
  ),
  TARGET: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M19.5 12c0-4.142-3.358-7.5-7.5-7.5S4.5 7.858 4.5 12s3.358 7.5 7.5 7.5 7.5-3.358 7.5-7.5zM12 8.25v3.75l2.25 1.35"
    />
  ),
  SPARKLES: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM18 13.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 18l-1.035.259a3.375 3.375 0 00-2.456 2.456L18 21.75l-.259-1.035a3.375 3.375 0 00-2.456-2.456L14.25 18l1.036-.259a3.375 3.375 0 002.456-2.456L18 13.25z"
    />
  ),
  ADD: <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />,
  TRASH: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
    />
  ),
  SETTINGS: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M10.343 3.94c.09-.542.56-1.002 1.11-1.226M10.343 3.94v2.404c0 .362-.234.69-.57.84-1.33.66-2.483 1.69-3.31 2.94-.37.49-.68.99-.95 1.51-.55 1.02-.9 2.15-.9 3.32 0 1.21.35 2.34.95 3.37.27.52.58 1.02.95 1.51.83 1.25 1.98 2.28 3.31 2.94.34.15.57.48.57.84v2.404M15.06 20.06c-.09.542-.56 1.002-1.11 1.226m1.11-1.226v-2.404c0-.362.234-.69.57-.84 1.33-.66 2.483-1.69 3.31-2.94.37-.49.68-.99.95-1.51.55-1.02.9-2.15.9-3.32 0-1.21-.35-2.34-.95-3.37a6.93 6.93 0 00-.95-1.51c-.83-1.25-1.98-2.28-3.31-2.94a1.12 1.12 0 00-.57-.84V3.94M15.06 20.06c.63.26 1.28.43 1.97.52M6 12a6 6 0 1112 0 6 6 0 01-12 0z"
    />
  ),
  HELP: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z"
    />
  ),
  MENU: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
    />
  ),
  DOCUMENT_TEXT: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m-1.125 9h5.25m-5.25 3h5.25M5.25 3v18h13.5V8.25l-4.5-4.5H5.25z"
    />
  ),
  GRIP_VERTICAL: (
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l.007 14M15 5l.007 14" />
  ),
  RECYCLE: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 00-3.7-3.7 48.678 48.678 0 00-7.324 0 4.006 4.006 0 00-3.7 3.7c-.092 1.21-.138 2.43-.138 3.662v4.28c0 .894.362 1.758.955 2.37.593.612 1.407.95 2.28.95h8.572c.873 0 1.687-.338 2.28-.95.593-.612.955-1.476.955-2.37v-4.28zM14.25 8.25l-3 3m0 0l-3-3m3 3v6"
    />
  ),
  LIGHTNING_BOLT: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z"
    />
  ),
  CAMERA: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.776 48.776 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316zM12 15a3.75 3.75 0 100-7.5 3.75 3.75 0 000 7.5z"
    />
  ),
  PHOTO: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"
    />
  ),
  CONTINUE: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M17.25 8.25L21 12m0 0l-3.75 3.75M21 12H3"
    />
  ),
  IMPROVE: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.998 15.998 0 011.622-3.385"
    />
  ),
  DIALOGUE: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.006 3 11.55c0 2.583 1.44 4.883 3.67 6.337L5.16 21.74a.75.75 0 001.06 1.06l3.37-3.37a9.42 9.42 0 002.41.32z"
    />
  ),
  BRAINSTORM: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M10.5 21a2.25 2.25 0 002.25-2.25V18.75a.75.75 0 011.5 0v.001a2.25 2.25 0 002.25 2.25H18a2.25 2.25 0 002.25-2.25V16.5a2.25 2.25 0 00-2.25-2.25h-.75a.75.75 0 01-.75-.75V12a4.5 4.5 0 00-9 0v1.5a.75.75 0 01-.75.75h-.75A2.25 2.25 0 003 16.5v2.25a2.25 2.25 0 002.25 2.25h1.5A2.25 2.25 0 0010.5 21z"
    />
  ),
  NEWSPAPER: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 01-2.25 2.25M16.5 7.5V18a2.25 2.25 0 002.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 002.25 2.25h13.5"
    />
  ),
  UNDO: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"
    />
  ),
  REDO: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M15 15l6-6m0 0l-6-6m6 6H9a6 6 0 000 12h3"
    />
  ),
  CHECK: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  ),
  CHANGE_TONE: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M14.25 2.25c-.244.244-.488.488-.732.732a10.493 10.493 0 00-3.29 5.253 10.493 10.493 0 00-3.29-5.253C6.703 2.738 6.459 2.494 6.215 2.25m8.035 0a10.47 10.47 0 01-8.035 0M2.25 12c0 4.142 3.358 7.5 7.5 7.5s7.5-3.358 7.5-7.5c0-1.01-.2-1.97-.568-2.848M2.25 12V9.75M17.25 12v2.25"
      transform="rotate(-45 12 12)"
    />
  ),
  SCENEBOARD: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"
    />
  ),
  CHARACTERGRAPH: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M2.25 7.125C2.25 6.504 2.754 6 3.375 6h6c.621 0 1.125.504 1.125 1.125v3.75c0 .621-.504 1.125-1.125 1.125h-6A1.125 1.125 0 012.25 10.875v-3.75zM14.25 8.625c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v8.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-8.25zM3.75 16.125c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v2.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-2.25z"
    />
  ),
  CONSISTENCYCHECKER: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  ),
  CRITIC: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0118 18a8.967 8.967 0 01-6 2.292m0-14.25v14.25"
    />
  ),
};

export const STORY_TEMPLATES: Template[] = [
  {
    id: 'three-act',
    name: 'templates.threeAct.name',
    description: 'templates.threeAct.description',
    type: 'Structure',
    tags: ['tags.classic', 'tags.plotDriven', 'tags.beginnerFriendly'],
    arcDescription: 'templates.threeAct.arc',
    sections: [
      { titleKey: 'templates.threeAct.sections.1' },
      { titleKey: 'templates.threeAct.sections.2' },
      { titleKey: 'templates.threeAct.sections.3' },
      { titleKey: 'templates.threeAct.sections.4' },
      { titleKey: 'templates.threeAct.sections.5' },
      { titleKey: 'templates.threeAct.sections.6' },
      { titleKey: 'templates.threeAct.sections.7' },
      { titleKey: 'templates.threeAct.sections.8' },
      { titleKey: 'templates.threeAct.sections.9' },
      { titleKey: 'templates.threeAct.sections.10' },
    ],
  },
  {
    id: 'heros-journey',
    name: 'templates.herosJourney.name',
    description: 'templates.herosJourney.description',
    type: 'Structure',
    tags: ['tags.classic', 'tags.characterDriven', 'tags.epic'],
    arcDescription: 'templates.herosJourney.arc',
    sections: [
      { titleKey: 'templates.herosJourney.sections.1' },
      { titleKey: 'templates.herosJourney.sections.2' },
      { titleKey: 'templates.herosJourney.sections.3' },
      { titleKey: 'templates.herosJourney.sections.4' },
      { titleKey: 'templates.herosJourney.sections.5' },
      { titleKey: 'templates.herosJourney.sections.6' },
      { titleKey: 'templates.herosJourney.sections.7' },
      { titleKey: 'templates.herosJourney.sections.8' },
      { titleKey: 'templates.herosJourney.sections.9' },
      { titleKey: 'templates.herosJourney.sections.10' },
      { titleKey: 'templates.herosJourney.sections.11' },
      { titleKey: 'templates.herosJourney.sections.12' },
    ],
  },
  {
    id: 'save-the-cat',
    name: 'templates.saveTheCat.name',
    description: 'templates.saveTheCat.description',
    type: 'Structure',
    tags: ['tags.screenwriting', 'tags.plotDriven', 'tags.commercial'],
    arcDescription: 'templates.saveTheCat.arc',
    sections: [
      { titleKey: 'templates.saveTheCat.sections.1' },
      { titleKey: 'templates.saveTheCat.sections.2' },
      { titleKey: 'templates.saveTheCat.sections.3' },
      { titleKey: 'templates.saveTheCat.sections.4' },
      { titleKey: 'templates.saveTheCat.sections.5' },
      { titleKey: 'templates.saveTheCat.sections.6' },
      { titleKey: 'templates.saveTheCat.sections.7' },
      { titleKey: 'templates.saveTheCat.sections.8' },
      { titleKey: 'templates.saveTheCat.sections.9' },
      { titleKey: 'templates.saveTheCat.sections.10' },
      { titleKey: 'templates.saveTheCat.sections.11' },
      { titleKey: 'templates.saveTheCat.sections.12' },
      { titleKey: 'templates.saveTheCat.sections.13' },
      { titleKey: 'templates.saveTheCat.sections.14' },
      { titleKey: 'templates.saveTheCat.sections.15' },
    ],
  },
  {
    id: 'fichtean-curve',
    name: 'templates.fichteanCurve.name',
    description: 'templates.fichteanCurve.description',
    type: 'Structure',
    tags: ['tags.fastPaced', 'tags.thriller', 'tags.inMediaRes'],
    arcDescription: 'templates.fichteanCurve.arc',
    sections: [
      { titleKey: 'templates.fichteanCurve.sections.1' },
      { titleKey: 'templates.fichteanCurve.sections.2' },
      { titleKey: 'templates.fichteanCurve.sections.3' },
      { titleKey: 'templates.fichteanCurve.sections.4' },
      { titleKey: 'templates.fichteanCurve.sections.5' },
      { titleKey: 'templates.fichteanCurve.sections.6' },
    ],
  },
  {
    id: 'murder-mystery',
    name: 'templates.murderMystery.name',
    description: 'templates.murderMystery.description',
    type: 'Genre',
    tags: ['tags.plotDriven', 'tags.investigation', 'tags.suspense'],
    arcDescription: 'templates.murderMystery.arc',
    sections: [
      { titleKey: 'templates.murderMystery.sections.1' },
      { titleKey: 'templates.murderMystery.sections.2' },
      { titleKey: 'templates.murderMystery.sections.3' },
      { titleKey: 'templates.murderMystery.sections.4' },
      { titleKey: 'templates.murderMystery.sections.5' },
      { titleKey: 'templates.murderMystery.sections.6' },
      { titleKey: 'templates.murderMystery.sections.7' },
      { titleKey: 'templates.murderMystery.sections.8' },
      { titleKey: 'templates.murderMystery.sections.9' },
      { titleKey: 'templates.murderMystery.sections.10' },
    ],
  },
  {
    id: 'space-opera',
    name: 'templates.spaceOpera.name',
    description: 'templates.spaceOpera.description',
    type: 'Genre',
    tags: ['tags.sciFi', 'tags.epic', 'tags.adventure'],
    arcDescription: 'templates.spaceOpera.arc',
    sections: [
      { titleKey: 'templates.spaceOpera.sections.1' },
      { titleKey: 'templates.spaceOpera.sections.2' },
      { titleKey: 'templates.spaceOpera.sections.3' },
      { titleKey: 'templates.spaceOpera.sections.4' },
      { titleKey: 'templates.spaceOpera.sections.5' },
      { titleKey: 'templates.spaceOpera.sections.6' },
      { titleKey: 'templates.spaceOpera.sections.7' },
      { titleKey: 'templates.spaceOpera.sections.8' },
      { titleKey: 'templates.spaceOpera.sections.9' },
      { titleKey: 'templates.spaceOpera.sections.10' },
      { titleKey: 'templates.spaceOpera.sections.11' },
    ],
  },
  {
    id: 'dystopian-fiction',
    name: 'templates.dystopian.name',
    description: 'templates.dystopian.description',
    type: 'Genre',
    tags: ['tags.sciFi', 'tags.socialCommentary', 'tags.rebellion'],
    arcDescription: 'templates.dystopian.arc',
    sections: [
      { titleKey: 'templates.dystopian.sections.1' },
      { titleKey: 'templates.dystopian.sections.2' },
      { titleKey: 'templates.dystopian.sections.3' },
      { titleKey: 'templates.dystopian.sections.4' },
      { titleKey: 'templates.dystopian.sections.5' },
      { titleKey: 'templates.dystopian.sections.6' },
      { titleKey: 'templates.dystopian.sections.7' },
      { titleKey: 'templates.dystopian.sections.8' },
      { titleKey: 'templates.dystopian.sections.9' },
    ],
  },
  {
    id: 'classic-romance',
    name: 'templates.romance.name',
    description: 'templates.romance.description',
    type: 'Genre',
    tags: ['tags.characterDriven', 'tags.romance', 'tags.emotional'],
    arcDescription: 'templates.romance.arc',
    sections: [
      { titleKey: 'templates.romance.sections.1' },
      { titleKey: 'templates.romance.sections.2' },
      { titleKey: 'templates.romance.sections.3' },
      { titleKey: 'templates.romance.sections.4' },
      { titleKey: 'templates.romance.sections.5' },
      { titleKey: 'templates.romance.sections.6' },
      { titleKey: 'templates.romance.sections.7' },
      { titleKey: 'templates.romance.sections.8' },
    ],
  },
  {
    id: 'thriller',
    name: 'templates.thriller.name',
    description: 'templates.thriller.description',
    type: 'Genre',
    tags: ['tags.suspense', 'tags.plotDriven', 'tags.fastPaced'],
    arcDescription: 'templates.thriller.arc',
    sections: [
      { titleKey: 'templates.thriller.sections.1' },
      { titleKey: 'templates.thriller.sections.2' },
      { titleKey: 'templates.thriller.sections.3' },
      { titleKey: 'templates.thriller.sections.4' },
      { titleKey: 'templates.thriller.sections.5' },
      { titleKey: 'templates.thriller.sections.6' },
      { titleKey: 'templates.thriller.sections.7' },
    ],
  },
  {
    id: 'fantasy',
    name: 'templates.fantasy.name',
    description: 'templates.fantasy.description',
    type: 'Genre',
    tags: ['tags.epic', 'tags.adventure', 'tags.characterDriven'],
    arcDescription: 'templates.fantasy.arc',
    sections: [
      { titleKey: 'templates.fantasy.sections.1' },
      { titleKey: 'templates.fantasy.sections.2' },
      { titleKey: 'templates.fantasy.sections.3' },
      { titleKey: 'templates.fantasy.sections.4' },
      { titleKey: 'templates.fantasy.sections.5' },
      { titleKey: 'templates.fantasy.sections.6' },
      { titleKey: 'templates.fantasy.sections.7' },
      { titleKey: 'templates.fantasy.sections.8' },
    ],
  },
  {
    id: 'horror',
    name: 'templates.horror.name',
    description: 'templates.horror.description',
    type: 'Genre',
    tags: ['tags.suspense', 'tags.plotDriven'],
    arcDescription: 'templates.horror.arc',
    sections: [
      { titleKey: 'templates.horror.sections.1' },
      { titleKey: 'templates.horror.sections.2' },
      { titleKey: 'templates.horror.sections.3' },
      { titleKey: 'templates.horror.sections.4' },
      { titleKey: 'templates.horror.sections.5' },
      { titleKey: 'templates.horror.sections.6' },
      { titleKey: 'templates.horror.sections.7' },
    ],
  },
  {
    id: 'historical-fiction',
    name: 'templates.historical.name',
    description: 'templates.historical.description',
    type: 'Genre',
    tags: ['tags.characterDriven', 'tags.emotional'],
    arcDescription: 'templates.historical.arc',
    sections: [
      { titleKey: 'templates.historical.sections.1' },
      { titleKey: 'templates.historical.sections.2' },
      { titleKey: 'templates.historical.sections.3' },
      { titleKey: 'templates.historical.sections.4' },
      { titleKey: 'templates.historical.sections.5' },
      { titleKey: 'templates.historical.sections.6' },
    ],
  },
  {
    id: 'coming-of-age',
    name: 'templates.comingOfAge.name',
    description: 'templates.comingOfAge.description',
    type: 'Genre',
    tags: ['tags.characterDriven', 'tags.emotional'],
    arcDescription: 'templates.comingOfAge.arc',
    sections: [
      { titleKey: 'templates.comingOfAge.sections.1' },
      { titleKey: 'templates.comingOfAge.sections.2' },
      { titleKey: 'templates.comingOfAge.sections.3' },
      { titleKey: 'templates.comingOfAge.sections.4' },
      { titleKey: 'templates.comingOfAge.sections.5' },
      { titleKey: 'templates.comingOfAge.sections.6' },
    ],
  },
  {
    id: 'adventure',
    name: 'templates.adventure.name',
    description: 'templates.adventure.description',
    type: 'Genre',
    tags: ['tags.adventure', 'tags.fastPaced', 'tags.plotDriven'],
    arcDescription: 'templates.adventure.arc',
    sections: [
      { titleKey: 'templates.adventure.sections.1' },
      { titleKey: 'templates.adventure.sections.2' },
      { titleKey: 'templates.adventure.sections.3' },
      { titleKey: 'templates.adventure.sections.4' },
      { titleKey: 'templates.adventure.sections.5' },
      { titleKey: 'templates.adventure.sections.6' },
    ],
  },
  {
    id: 'mystery',
    name: 'templates.mystery.name',
    description: 'templates.mystery.description',
    type: 'Genre',
    tags: ['tags.investigation', 'tags.suspense', 'tags.plotDriven'],
    arcDescription: 'templates.mystery.arc',
    sections: [
      { titleKey: 'templates.mystery.sections.1' },
      { titleKey: 'templates.mystery.sections.2' },
      { titleKey: 'templates.mystery.sections.3' },
      { titleKey: 'templates.mystery.sections.4' },
      { titleKey: 'templates.mystery.sections.5' },
      { titleKey: 'templates.mystery.sections.6' },
    ],
  },
];
