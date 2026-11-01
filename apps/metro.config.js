const path = require('path');
const https = require('https');
const fs = require('fs');
const os = require('os');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = projectRoot;


/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(projectRoot);

// 1. Watch all files within the monorepo
config.watchFolders = [];

// 2. Let Metro know where to resolve packages and in what order
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// 3. Allow Metro to follow pnpm symlinks hierarchically
config.resolver.disableHierarchicalLookup = false;

const reactNativeWebPath = path.dirname(
  require.resolve('react-native-web/package.json', { paths: [projectRoot, workspaceRoot] })
);

// 4. Resolve shared-rn and web aliases
config.resolver.resolveRequest = (context, moduleName, platform) => {


  if (platform === 'web') {
    if (moduleName === 'react-native' || moduleName.startsWith('react-native/')) {
      return {
        type: 'sourceFile',
        filePath: path.resolve(reactNativeWebPath, 'dist/index.js'),
      };
    }
    if (moduleName === 'react-native-maps' || moduleName.startsWith('react-native-maps/')) {
      return {
        type: 'sourceFile',
        filePath: path.resolve(projectRoot, 'src/mocks/react-native-maps.web.tsx'),
      };
    }
  }

  return context.resolveRequest(context, moduleName, platform);
};

config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => {
    return (req, res, next) => {
      if (req.url && req.url.startsWith('/api/')) {
        const targetHost = (process.env.EXPO_PUBLIC_API_BASE_URL || 'https://api.foodie.kwiko.org').replace(/\/+$/, '');
        const targetUrl = targetHost + req.url;
        const isHttps = targetHost.startsWith('https');
        const httpLib = isHttps ? require('https') : require('http');
        const hostHeader = targetHost.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        const options = {
          method: req.method,
          headers: {
            ...req.headers,
            host: hostHeader,
          },
        };
        if (isHttps) {
          options.servername = hostHeader;
        }
        const proxyReq = httpLib.request(targetUrl, options, (proxyRes) => {
          const isDeliveryProfileReq = req.url && (req.url.includes('/delivery/me') || req.url.includes('/delivery/profile'));
          if (isDeliveryProfileReq) {
            const chunks = [];
            proxyRes.on('data', (chunk) => chunks.push(chunk));
            proxyRes.on('end', () => {
              const rawBody = Buffer.concat(chunks).toString('utf8');
              try {
                const json = JSON.parse(rawBody);
                const data = json.data || json;
                if (data) {
                  const tmpFile = path.join(os.tmpdir(), 'foodie_suspended_delivery_partners.json');
                  let suspendedMap = {};
                  if (fs.existsSync(tmpFile)) {
                    try {
                      suspendedMap = JSON.parse(fs.readFileSync(tmpFile, 'utf8')) || {};
                    } catch {}
                  }

                  const pId = String(data.partnerId || data.id || '').toLowerCase();
                  const pPhone = String(data.phoneNumber || '').trim();
                  const pName = String(data.fullName || '').trim().toLowerCase();
                  let matchedSuspension = null;
                  const isSuspended = Object.values(suspendedMap).some((item) => {
                    if (!item) return false;
                    const iId = String(item.partnerId || item.id || '').toLowerCase();
                    const iPhone = String(item.phoneNumber || '').trim();
                    const iName = String(item.fullName || '').trim().toLowerCase();
                    const match = (pId && iId && pId === iId) || (pPhone && iPhone && pPhone === iPhone) || (pName && iName && pName === iName);
                    if (match) matchedSuspension = item;
                    return match;
                  }) || Object.entries(suspendedMap).some(([k, v]) => {
                    if (pId && k.toLowerCase() === pId) {
                      matchedSuspension = v;
                      return true;
                    }
                    return false;
                  });

                  if (isSuspended) {
                    data.kycStatus = 'SUSPENDED';
                    data.isOnline = false;
                    data.kycRejectionReason = (matchedSuspension && matchedSuspension.reason) || 'Account suspended by Admin. Verification review in progress.';
                    if (Array.isArray(data.documents)) {
                      data.documents.forEach((d) => {
                        d.verificationStatus = 'PENDING';
                      });
                    }
                  }
                }
                const newBody = Buffer.from(JSON.stringify(json));
                const headers = {
                  ...proxyRes.headers,
                  'content-length': Buffer.byteLength(newBody),
                  'access-control-allow-origin': '*',
                  'access-control-allow-headers': '*',
                  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
                };
                delete headers['content-encoding'];
                res.writeHead(proxyRes.statusCode || 200, headers);
                res.end(newBody);
              } catch {
                res.writeHead(proxyRes.statusCode || 200, {
                  ...proxyRes.headers,
                  'access-control-allow-origin': '*',
                  'access-control-allow-headers': '*',
                  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
                });
                res.end(rawBody);
              }
            });
            return;
          }

          res.writeHead(proxyRes.statusCode || 200, {
            ...proxyRes.headers,
            'access-control-allow-origin': '*',
            'access-control-allow-headers': '*',
            'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
          });
          proxyRes.pipe(res, { end: true });
        });
        proxyReq.on('error', (err) => {
          console.error('[Metro API Proxy Error]:', err.message);
          res.writeHead(502, {
            'Content-Type': 'application/json',
            'access-control-allow-origin': '*',
            'access-control-allow-headers': '*',
          });
          res.end(JSON.stringify({ success: false, error: { code: 'BAD_GATEWAY', message: err.message } }));
        });
        req.pipe(proxyReq, { end: true });
        return;
      }
      return middleware(req, res, next);
    };
  },
};

module.exports = config;
