// Small input checkers. Every field from the outside world goes through one of these.

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const LIMITS = {
  title: 120,
  summary: 300,
  shortText: 120,
  notes: 20000,
  comment: 2000,
  displayName: 40,
  bio: 300,
  link: 500,
};

export const ITEM_ID = /^[a-z0-9][a-z0-9-]{0,80}$/; // library item ids: "weigh-jupiter", "c-0a1b2c..."
export const ENTITY_ID = /^[A-Za-z0-9_-]{6,64}$/; // ids we generate
export const POST_ID = /^(experiment|book|observation)~[A-Za-z0-9-]{1,64}~[A-Za-z0-9_-]{1,81}$/;

const fail = (field, msg) => {
  throw new HttpError(400, `${field}: ${msg}`, { field });
};

export function str(body, field, { max = LIMITS.shortText, min = 0, required = false } = {}) {
  const v = body?.[field];
  if (v === undefined || v === null || v === '') {
    if (required) fail(field, 'is required');
    return '';
  }
  if (typeof v !== 'string') fail(field, 'must be text');
  const t = v.replace(/\u0000/g, '').trim();
  if (t.length < min) fail(field, `must be at least ${min} characters`);
  if (t.length > max) fail(field, `must be at most ${max} characters`);
  return t;
}

export function oneOf(body, field, options, { required = true, fallback } = {}) {
  const v = body?.[field];
  if (v === undefined || v === null || v === '') {
    if (fallback !== undefined) return fallback;
    if (required) fail(field, 'is required');
    return '';
  }
  if (!options.includes(v)) fail(field, `must be one of ${options.join(', ')}`);
  return v;
}

export function bool(body, field) {
  const v = body?.[field];
  if (v === undefined || v === null) return false;
  if (typeof v !== 'boolean') fail(field, 'must be true or false');
  return v;
}

export function date(body, field) {
  const v = body?.[field];
  if (v === undefined || v === null || v === '') return '';
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) {
    fail(field, 'must be a date like 2026-10-20');
  }
  return v;
}

export function url(body, field) {
  const v = str(body, field, { max: LIMITS.link });
  if (v && !/^https?:\/\/[^\s]+$/i.test(v)) fail(field, 'must be a web address starting with https://');
  return v;
}

export function param(value, pattern, name) {
  if (typeof value !== 'string' || !pattern.test(value)) throw new HttpError(400, `${name} is not valid`);
  return value;
}
