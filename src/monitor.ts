import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';

interface AuthData {
  accessToken: string;
  accountId?: string;
}

interface RateLimits {
  primary?: { used_percent: number; resets_in_seconds?: number };
  secondary?: { used_percent: number; resets_in_seconds?: number };
}

let statusBarItem: vscode.StatusBarItem;
let infoPanel: vscode.WebviewPanel | undefined;
let primaryEnabled = true;
let secondaryEnabled = true;

function loadAuth(): AuthData | null {
  try {
    const authPath = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'auth.json');
    if (!fs.existsSync(authPath)) return null;
    const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    if (!auth.tokens) return null;
    return { accessToken: auth.tokens.access_token, accountId: auth.tokens.account_id };
  } catch {
    return null;
  }
}

function parseHeader(headers: any, name: string): number | null {
  const v = headers[name] || headers[name.toLowerCase()];
  if (!v) return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function extractLimits(headers: any): RateLimits | null {
  const limits: RateLimits = {};
  const p = parseHeader(headers, 'x-codex-primary-used-percent');
  if (p !== null) {
    limits.primary = {
      used_percent: p,
      resets_in_seconds: parseHeader(headers, 'x-codex-primary-reset-after-seconds') || undefined
    };
  }
  const s = parseHeader(headers, 'x-codex-secondary-used-percent');
  if (s !== null) {
    limits.secondary = {
      used_percent: s,
      resets_in_seconds: parseHeader(headers, 'x-codex-secondary-reset-after-seconds') || undefined
    };
  }
  return limits.primary || limits.secondary ? limits : null;
}

async function pingCodex(auth: AuthData): Promise<RateLimits | null> {
  try {
    const sid = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('');
    const h: Record<string, string> = {
      'OpenAI-Beta': 'responses=experimental',
      session_id: sid,
      Accept: 'text/event-stream',
      originator: 'codex_ping',
      'User-Agent': 'codex-ping/0.1.0',
      Authorization: `Bearer ${auth.accessToken}`,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache'
    };
    if (auth.accountId) h['chatgpt-account-id'] = auth.accountId;
    const r = await axios.post('https://chatgpt.com/backend-api/codex/responses', {
      model: 'gpt-5',
      instructions: 'hi',
      input: [{ type: 'message', id: null, role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
      tools: [],
      tool_choice: 'auto',
      parallel_tool_calls: false,
      reasoning: { effort: 'medium', summary: 'auto' },
      store: false,
      stream: true,
      include: ['reasoning.encrypted_content'],
      prompt_cache_key: sid
    }, { headers: h, responseType: 'stream', validateStatus: () => true });
    if (r.data?.destroy) r.data.destroy();
    return extractLimits(r.headers);
  } catch (e) {
    if (axios.isAxiosError(e) && e.response) {
      return extractLimits(e.response.headers);
    }
    return null;
  }
}

let primaryResetTime: number | null = null;
let secondaryResetTime: number | null = null;
let primaryTimer: NodeJS.Timeout | null = null;
let secondaryTimer: NodeJS.Timeout | null = null;
let lastPingTime: Date | null = null;
let pingCount = 0;
let lastLimits: RateLimits | null = null;

function updateStatusBar(): void {
  if (!statusBarItem) return;
  const auth = loadAuth();
  if (!auth) {
    statusBarItem.text = '$(sync)';
    statusBarItem.tooltip = 'Authentication required. Run `codex login`.';
    statusBarItem.show();
    return;
  }
  
  const now = Date.now();
  let nextPingTime: number | null = null;
  
  if (primaryEnabled && primaryResetTime) {
    nextPingTime = primaryResetTime;
  }
  if (secondaryEnabled && secondaryResetTime) {
    if (!nextPingTime || secondaryResetTime < nextPingTime) {
      nextPingTime = secondaryResetTime;
    }
  }
  
  if (nextPingTime) {
    const minutes = Math.round((nextPingTime - now) / 60000);
    statusBarItem.text = `$(sync) ${minutes}m`;
    statusBarItem.tooltip = `Next ping in ${minutes} minutes. Click to view details.`;
  } else {
    statusBarItem.text = '$(sync)';
    statusBarItem.tooltip = 'Click to view details';
  }
  
  statusBarItem.show();
}

function formatTime(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  return `${Math.round(ms / 3600000)}h`;
}

function createInfoPanel(): void {
  if (infoPanel) {
    infoPanel.reveal();
    return;
  }

  infoPanel = vscode.window.createWebviewPanel(
    'codexPingInfo',
    'Codex Ping - Details',
    vscode.ViewColumn.Two,
    { enableScripts: true }
  );

  function updateContent(): void {
    const auth = loadAuth();
    const now = Date.now();
    const primaryTime = primaryResetTime ? formatTime(primaryResetTime - now) : 'N/A';
    const secondaryTime = secondaryResetTime ? formatTime(secondaryResetTime - now) : 'N/A';
    const lastPing = lastPingTime ? lastPingTime.toLocaleString() : 'Never';
    const primaryPercent = lastLimits?.primary?.used_percent?.toFixed(1) || 'N/A';
    const secondaryPercent = lastLimits?.secondary?.used_percent?.toFixed(1) || 'N/A';

    infoPanel!.webview.html = `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: var(--vscode-font-family); padding: 20px; }
    h2 { margin-top: 0; }
    .info { margin: 10px 0; display: flex; align-items: center; }
    .label { font-weight: bold; min-width: 150px; }
    .value { margin-left: 10px; }
    .toggle { margin-left: 10px; }
    .toggle input { margin-right: 5px; }
  </style>
</head>
<body>
  <h2>Codex Ping Status</h2>
  <div class="info"><span class="label">Auth:</span><span class="value">${auth ? '✓ Authenticated' : '✗ No auth'}</span></div>
  <div class="info">
    <span class="label">Primary Limit (5h):</span>
    <span class="value">${primaryPercent}% (reset in ${primaryTime})</span>
    <span class="toggle">
      <input type="checkbox" id="primaryToggle" ${primaryEnabled ? 'checked' : ''}>
      <label for="primaryToggle">Auto-ping</label>
    </span>
  </div>
  <div class="info">
    <span class="label">Secondary Limit (7d):</span>
    <span class="value">${secondaryPercent}% (reset in ${secondaryTime})</span>
    <span class="toggle">
      <input type="checkbox" id="secondaryToggle" ${secondaryEnabled ? 'checked' : ''}>
      <label for="secondaryToggle">Auto-ping</label>
    </span>
  </div>
  <div class="info"><span class="label">Last Ping:</span><span class="value">${lastPing}</span></div>
  <div class="info"><span class="label">Total Pings:</span><span class="value">${pingCount}</span></div>
  <script>
    const vscode = acquireVsCodeApi();
    document.getElementById('primaryToggle').addEventListener('change', (e) => {
      vscode.postMessage({ command: 'togglePrimary', enabled: e.target.checked });
    });
    document.getElementById('secondaryToggle').addEventListener('change', (e) => {
      vscode.postMessage({ command: 'toggleSecondary', enabled: e.target.checked });
    });
  </script>
</body>
</html>`;
  }

  updateContent();
  const interval = setInterval(updateContent, 1000);

  infoPanel.webview.onDidReceiveMessage(message => {
    if (message.command === 'togglePrimary') {
      primaryEnabled = message.enabled;
      if (!primaryEnabled && primaryTimer) {
        clearTimeout(primaryTimer);
        primaryTimer = null;
      } else if (primaryEnabled && primaryResetTime) {
        schedulePing(primaryResetTime, 'Primary');
      }
    } else if (message.command === 'toggleSecondary') {
      secondaryEnabled = message.enabled;
      if (!secondaryEnabled && secondaryTimer) {
        clearTimeout(secondaryTimer);
        secondaryTimer = null;
      } else if (secondaryEnabled && secondaryResetTime) {
        schedulePing(secondaryResetTime, 'Secondary');
      }
    }
  });

  infoPanel.onDidDispose(() => {
    clearInterval(interval);
    infoPanel = undefined;
  });
}

function schedulePing(resetTime: number | null, type: string): void {
  if (!resetTime) return;
  if (type === 'Primary' && !primaryEnabled) return;
  if (type === 'Secondary' && !secondaryEnabled) return;
  
  const now = Date.now();
  const delay = Math.max(0, resetTime - now);
  
  if (delay > 0) {
    const timer = setTimeout(async () => {
      const auth = loadAuth();
      if (auth) {
        pingCount++;
        lastPingTime = new Date();
        console.log(`[${lastPingTime.toISOString()}] ${type} limit reset! Pinging Codex...`);
        const limits = await pingCodex(auth);
        if (limits) {
          lastLimits = limits;
          const now2 = Date.now();
          const newPrimaryReset = limits.primary?.resets_in_seconds ? now2 + limits.primary.resets_in_seconds * 1000 : null;
          const newSecondaryReset = limits.secondary?.resets_in_seconds ? now2 + limits.secondary.resets_in_seconds * 1000 : null;
          if (newPrimaryReset !== primaryResetTime) {
            if (primaryTimer) clearTimeout(primaryTimer);
            primaryResetTime = newPrimaryReset;
            if (primaryEnabled) schedulePing(newPrimaryReset, 'Primary');
          }
          if (newSecondaryReset !== secondaryResetTime) {
            if (secondaryTimer) clearTimeout(secondaryTimer);
            secondaryResetTime = newSecondaryReset;
            if (secondaryEnabled) schedulePing(newSecondaryReset, 'Secondary');
          }
        }
        console.log('Ping sent');
        updateStatusBar();
      }
      if (type === 'Primary') primaryTimer = null;
      if (type === 'Secondary') secondaryTimer = null;
    }, delay);
    
    if (type === 'Primary') primaryTimer = timer;
    if (type === 'Secondary') secondaryTimer = timer;
    
    const delaySec = Math.round(delay / 1000);
    console.log(`${type} limit reset scheduled in ${delaySec}s (${new Date(resetTime).toISOString()})`);
  } else {
    const auth = loadAuth();
    if (auth) {
      pingCount++;
      lastPingTime = new Date();
      console.log(`[${lastPingTime.toISOString()}] ${type} limit already reset! Pinging Codex...`);
      pingCodex(auth).then(limits => {
        if (limits) {
          lastLimits = limits;
          const now2 = Date.now();
          const newPrimaryReset = limits.primary?.resets_in_seconds ? now2 + limits.primary.resets_in_seconds * 1000 : null;
          const newSecondaryReset = limits.secondary?.resets_in_seconds ? now2 + limits.secondary.resets_in_seconds * 1000 : null;
          if (newPrimaryReset !== primaryResetTime) {
            if (primaryTimer) clearTimeout(primaryTimer);
            primaryResetTime = newPrimaryReset;
            if (primaryEnabled) schedulePing(newPrimaryReset, 'Primary');
          }
          if (newSecondaryReset !== secondaryResetTime) {
            if (secondaryTimer) clearTimeout(secondaryTimer);
            secondaryResetTime = newSecondaryReset;
            if (secondaryEnabled) schedulePing(newSecondaryReset, 'Secondary');
          }
        }
        console.log('Ping sent');
        updateStatusBar();
      });
    }
  }
}

async function checkLimits(): Promise<void> {
  const auth = loadAuth();
  if (!auth) {
    updateStatusBar();
    return;
  }

  const limits = await pingCodex(auth);
  if (!limits) {
    updateStatusBar();
    return;
  }

  lastLimits = limits;
  const now = Date.now();
  const newPrimaryReset = limits.primary?.resets_in_seconds ? now + limits.primary.resets_in_seconds * 1000 : null;
  const newSecondaryReset = limits.secondary?.resets_in_seconds ? now + limits.secondary.resets_in_seconds * 1000 : null;

  if (newPrimaryReset !== primaryResetTime) {
    if (primaryTimer) clearTimeout(primaryTimer);
    primaryResetTime = newPrimaryReset;
    if (primaryEnabled) schedulePing(newPrimaryReset, 'Primary');
  }

  if (newSecondaryReset !== secondaryResetTime) {
    if (secondaryTimer) clearTimeout(secondaryTimer);
    secondaryResetTime = newSecondaryReset;
    if (secondaryEnabled) schedulePing(newSecondaryReset, 'Secondary');
  }

  updateStatusBar();
}

export function startMonitoring(context: vscode.ExtensionContext): void {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'codex-ping.showInfo';
  context.subscriptions.push(statusBarItem);
  updateStatusBar();
  
  context.subscriptions.push(vscode.commands.registerCommand('codex-ping.showInfo', () => {
    createInfoPanel();
  }));

  const statusBarInterval = setInterval(updateStatusBar, 60000);
  context.subscriptions.push({ dispose: () => clearInterval(statusBarInterval) });

  console.log('Codex Ping started. Monitoring rate limit resets...');
  checkLimits();
}
