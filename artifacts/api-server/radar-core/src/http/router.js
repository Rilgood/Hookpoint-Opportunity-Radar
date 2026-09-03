import { AppError } from '../lib.js';

export class Router {
  constructor() { this.routes = []; }
  get(path, handler, options) { this.add('GET', path, handler, options); }
  post(path, handler, options) { this.add('POST', path, handler, options); }
  patch(path, handler, options) { this.add('PATCH', path, handler, options); }
  delete(path, handler, options) { this.add('DELETE', path, handler, options); }
  add(method, path, handler, options = {}) {
    const keys = [];
    const expression = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:([A-Za-z0-9_]+)/g, (_, key) => { keys.push(key); return '([^/]+)'; });
    this.routes.push({ method, path, pattern: new RegExp(`^${expression}/?$`), keys, handler, options });
  }
  match(method, pathname) {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const match = pathname.match(route.pattern);
      if (!match) continue;
      let params;
      try { params = Object.fromEntries(route.keys.map((key, index) => [key, decodeURIComponent(match[index + 1])])); }
      catch { throw new AppError(400, 'invalid_path_parameter', 'A path parameter is not valid URL encoding.'); }
      return { ...route, params };
    }
    throw new AppError(404, 'route_not_found', `No route for ${method} ${pathname}`);
  }
}
