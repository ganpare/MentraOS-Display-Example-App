// 認証ミドルウェアの作成
import { MENTRAOS_API_KEY, PACKAGE_NAME, COOKIE_SECRET } from './config';
import * as path from 'path';

export function createAuthMiddleware(getAppSessionForUser: (userId: string) => any) {
  const webviewPath = path.join(__dirname, '../../node_modules/@mentra/sdk/dist/app/webview/index.js');
  const { createAuthMiddleware } = require(webviewPath);
  return createAuthMiddleware({
    apiKey: MENTRAOS_API_KEY,
    packageName: PACKAGE_NAME,
    cookieSecret: COOKIE_SECRET,
    getAppSessionForUser
  });
}

