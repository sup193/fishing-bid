function configuredPort(name, fallback) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${name} must be a valid TCP port`);
  }
  return value;
}

export const e2eHost = process.env.E2E_HOST || '127.0.0.1';
export const e2eApiPort = configuredPort('E2E_API_PORT', 5010);
export const e2eMobileApiPort = configuredPort('E2E_MOBILE_API_PORT', 5001);
export const e2eWebPort = configuredPort('E2E_WEB_PORT', 5174);
export const e2eMobileWebPort = configuredPort('E2E_MOBILE_WEB_PORT', 8081);

const configuredPorts = [e2eApiPort, e2eMobileApiPort, e2eWebPort, e2eMobileWebPort];
if (configuredPorts.includes(5000)) {
  throw new Error('Playwright must not use port 5000; it is reserved for the running application API');
}
if (new Set(configuredPorts).size !== configuredPorts.length) {
  throw new Error('Playwright API and frontend ports must be unique');
}

export const e2eWebUrl = `http://${e2eHost}:${e2eWebPort}`;
export const e2eApiUrl = `http://${e2eHost}:${e2eApiPort}/api`;
export const e2eMobileApiUrl = `http://${e2eHost}:${e2eMobileApiPort}/api`;
export const e2eMobileWebUrl = `http://localhost:${e2eMobileWebPort}`;
