'use strict';

const { HttpError } = require('./http-error');

function fail(message) {
  throw new HttpError(400, message);
}

function string(value, field, { min = 0, max = 200, optional = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (optional) return null;
    fail(`${field} is required`);
  }
  if (typeof value !== 'string') fail(`${field} must be text`);
  const trimmed = value.trim();
  if (trimmed.length === 0 && optional) return null;
  if (trimmed.length < min) fail(`${field} must be at least ${min} characters`);
  if (trimmed.length > max) fail(`${field} must be at most ${max} characters`);
  return trimmed;
}

function integer(value, field, { min = -Infinity, max = Infinity, optional = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (optional) return null;
    fail(`${field} is required`);
  }
  const number = typeof value === 'string' ? Number(value) : value;
  if (!Number.isInteger(number)) fail(`${field} must be a whole number`);
  if (number < min || number > max) fail(`${field} must be between ${min} and ${max}`);
  return number;
}

function number(value, field, { min = -Infinity, max = Infinity, optional = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (optional) return null;
    fail(`${field} is required`);
  }
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) fail(`${field} must be a number`);
  if (parsed < min || parsed > max) fail(`${field} must be between ${min} and ${max}`);
  return parsed;
}

function oneOf(value, field, allowed, { optional = false, fallback } = {}) {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback;
    if (optional) return null;
    fail(`${field} is required`);
  }
  if (!allowed.includes(value)) fail(`${field} must be one of: ${allowed.join(', ')}`);
  return value;
}

function boolean(value, field, { fallback = false } = {}) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') fail(`${field} must be true or false`);
  return value;
}

function isoDate(value, field) {
  const text = string(value, field, { max: 40 });
  const time = Date.parse(text);
  if (Number.isNaN(time)) fail(`${field} must be a valid date and time`);
  return new Date(time);
}

// Calendar date (YYYY-MM-DD) such as a birth date.
function calendarDate(value, field, { optional = false } = {}) {
  const text = string(value, field, { max: 10, optional });
  if (text === null) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) fail(`${field} must look like YYYY-MM-DD`);
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    fail(`${field} is not a real date`);
  }
  return text;
}

function email(value) {
  const text = string(value, 'Email', { max: 254 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) fail('Email address looks invalid');
  return text;
}

module.exports = { fail, string, integer, number, oneOf, boolean, isoDate, calendarDate, email };
