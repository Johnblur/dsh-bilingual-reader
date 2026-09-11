// src/host/clipboard.ts — read the OS clipboard WITHOUT Electron.
//
// Why: DSH Desktop >= 2.0.9 runs the host in an Electron `utilityProcess`
// (`startIsolatedDesktopHost`), where the `electron` module is unavailable —
// so `require('electron').clipboard.readText()` no longer works. We instead
// watch the OS clipboard from ONE long-lived child process that prints the
// text (base64) only when it changes; the route just reads the cached value.
// (Spawning a process per poll would be far too heavy at the client's cadence.)
import { spawn } from 'node:child_process';

export interface ClipboardWatcher {
  /** Latest clipboard text seen ('' until the first change). */
  read(): string;
  /** Whether the watcher process is alive. */
  available(): boolean;
  dispose(): void;
}

export function startClipboardWatcher(): ClipboardWatcher {
  let text = '';
  let available = false;
  let buf = '';
  let child: any;

  const platform = process.platform;
  let cmd = '';
  let args: string[] = [];

  if (platform === 'win32') {
    cmd = 'powershell.exe';
    args = ['-NoProfile', '-NonInteractive', '-Command',
      "$last=$null; while($true){ try{$t=Get-Clipboard -Raw -ErrorAction Stop}catch{$t=$null}; if($t -eq $null){$t=''}; " +
      "if($t -ne $last){ $last=$t; [Console]::Out.WriteLine([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($t))) }; " +
      "Start-Sleep -Milliseconds 300 }"];
  } else if (platform === 'darwin') {
    cmd = '/bin/sh';
    args = ['-c', "last=''; while true; do t=$(pbpaste 2>/dev/null); if [ \"$t\" != \"$last\" ]; then last=\"$t\"; printf '%s\\n' \"$(printf '%s' \"$t\" | base64)\"; fi; sleep 0.3; done"];
  } else {
    cmd = '/bin/sh';
    args = ['-c', "last=''; while true; do t=$(xclip -selection clipboard -o 2>/dev/null); if [ \"$t\" != \"$last\" ]; then last=\"$t\"; printf '%s\\n' \"$(printf '%s' \"$t\" | base64)\"; fi; sleep 0.3; done"];
  }

  try {
    child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    available = true;
    child.on('error', () => { available = false; });
    child.on('exit', () => { available = false; });
    child.stdout?.on('data', (d: Buffer) => {
      buf += d.toString('utf8');
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        try { text = Buffer.from(line, 'base64').toString('utf8'); } catch { /* ignore bad line */ }
      }
    });
  } catch {
    available = false;
  }

  return {
    read: () => text,
    available: () => available,
    dispose: () => { try { child?.kill(); } catch { /* ignore */ } },
  };
}
