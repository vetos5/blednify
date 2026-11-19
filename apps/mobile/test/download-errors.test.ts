import { expect, test } from 'bun:test';

import { classifyDownloadError, httpStatusOf } from '../src/core/download-errors';

test('reads the status out of Android and iOS native download errors', () => {
  expect(httpStatusOf('Unable to download a file: HTTP 404')).toBe(404);
  expect(httpStatusOf('Unable to download a file: response has status: 403')).toBe(403);
  expect(httpStatusOf('Unable to download a file: response has status 401')).toBe(401);
  expect(httpStatusOf('Unable to download a file: timeout')).toBeNull();
  expect(httpStatusOf('Unable to download a file: Unable to resolve host "music.example.com"')).toBeNull();
});

test('only gone songs and refused tokens are permanent; a refused token is told apart', () => {
  expect(classifyDownloadError('Unable to download a file: HTTP 404')).toEqual({
    permanent: true,
    auth: false,
    message: 'No longer on the server',
  });
  expect(classifyDownloadError('Unable to download a file: HTTP 401')).toEqual({
    permanent: true,
    auth: true,
    message: 'The server refused the access token',
  });
  expect(classifyDownloadError('Unable to download a file: response has status: 403').auth).toBe(true);
  expect(classifyDownloadError('Unable to download a file: HTTP 503').permanent).toBe(false);
  expect(classifyDownloadError('Software caused connection abort').permanent).toBe(false);
});

test('transient failures get plain words, never the native exception text', () => {
  expect(classifyDownloadError('Unable to download a file: HTTP 500').message).toBe('Server error, try again later');
  expect(classifyDownloadError('java.net.SocketTimeoutException: timeout').message).toBe('Connection lost');
  expect(classifyDownloadError('Unable to resolve host "music.example.com"').message).toBe('Connection lost');
  expect(classifyDownloadError('ENOSPC: no space left on device').message).toBe('Phone storage is full');
  expect(classifyDownloadError('Something odd happened').message).toBe('Couldn’t download');
});
