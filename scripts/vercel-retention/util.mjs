export const refuse = (reason) => {
  throw Object.assign(new Error(reason), { reason });
};

export const anyOf = (...flags) => flags.some(Boolean);

export const DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]+$/;
export const ALIAS_HOST = /^[a-z0-9][a-z0-9-]*\.vercel\.app$/;
export const FULL_SHA = /^[a-f0-9]{40}$/;

export function parseJson(text, what) {
  try {
    return JSON.parse(text);
  } catch {
    return refuse(`unparseable-${what}`);
  }
}

export const isTrue = (value) => value === true;
