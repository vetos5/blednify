import { expect, test } from 'bun:test';

import { classifyDownloadError, httpStatusOf } from '../src/core/download-errors';

test('reads the status out of Android and iOS native download errors', () => {
  expect(httpStatusOf('Unable to download a file: HTTP 404')).toBe(404);
  expect(httpStatusOf('Unable to download a file: response has status: 403')).toBe(403);
  expect(httpStatusOf('Unable to download a file: response has status 401')).toBe(401);
  expect(httpStatusOf('Unable to download a file: timeout')).toBeNull();
  expect(httpStatusOf('Unable to download a file: Unable to resolve host "music.example.com"')).toBeNull();
});

test('only gone songs and refused tokens are permanent', () => {
  expect(classifyDownloadError('Unable to download a file: HTTP 404')).toEqual({ permanent: true, message: 'No longer on the server' });
  expect(classifyDownloadError('Unable to download a file: HTTP 401').permanent).toBe(true);
  expect(classifyDownloadError('Unable to download a file: HTTP 503')).toEqual({
    permanent: false,
    message: 'Unable to download a file: HTTP 503',
  });
  expect(classifyDownloadError('Software caused connection abort').permanent).toBe(false);
});
