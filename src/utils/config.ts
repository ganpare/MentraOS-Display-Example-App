// 環境変数の設定
export const PACKAGE_NAME = process.env.PACKAGE_NAME ?? (() => { throw new Error('PACKAGE_NAME is not set in .env file'); })();
export const MENTRAOS_API_KEY = process.env.MENTRAOS_API_KEY ?? (() => { throw new Error('MENTRAOS_API_KEY is not set in .env file'); })();
export const PORT = parseInt(process.env.PORT || '3000');
export const COOKIE_SECRET = process.env.COOKIE_SECRET || 'your-secret-key-change-this-in-production';
export const SERVER_URL = process.env.SERVER_URL || `http://localhost:${PORT}`;
export const WEBVIEW_URL = process.env.WEBVIEW_URL || `${SERVER_URL}/webview/`;
export const AUDIO_SOURCE_DIR = process.env.AUDIO_SOURCE_DIR || '';
export const DEBUG = process.env.DEBUG === 'true';

