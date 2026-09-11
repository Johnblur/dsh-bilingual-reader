// src/host/clipboard.ts — read the OS clipboard WITHOUT Electron.
//
// Why: DSH Desktop >= 2.0.9 runs the host in an Electron `utilityProcess`
// (`startIsolatedDesktopHost`), where the `electron` module is unavailable —
// so `require('electron').clipboard.readText()` no longer works. We instead
// watch the OS clipboard from ONE long-lived child process (spawning a process
// per poll would be far too heavy at the client's cadence).
//
// Delivery uses TWO independent channels on purpose: stdout pipes are the
// natural choice, but a long-lived child's output can sit in a buffer, and a
// clipboard helper can fail for environment reasons. So the child also mirrors
// every change into a small temp file, which the host reads on demand. Either
// channel alone is enough to make the feature work.
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface ClipboardDebug {
  available: boolean;
  lines: number;
  bytes: number;
  /** Whether the temp-file mirror has produced usable content. */
  fileOk: boolean;
  /** How many times the HTTP route asked for the clipboard. */
  polls: number;
  /** Which read path the helper settled on (from its stderr banner). */
  mode: string;
  /** Last stderr tail from the watcher process (diagnosis). */
  err: string;
  /** Temp file used by the mirror channel. */
  file: string;
  /** Where this diagnostic snapshot is mirrored for out-of-band inspection. */
  status: string;
}

export interface ClipboardWatcher {
  /** Latest clipboard text seen ('' until the first change). */
  read(): string;
  /** Whether the watcher process is alive. */
  available(): boolean;
  debug(): ClipboardDebug;
  dispose(): void;
}

export function startClipboardWatcher(): ClipboardWatcher {
  let text = '';
  let available = false;
  let buf = '';
  let lines = 0;
  let bytes = 0;
  let err = '';
  let fileOk = false;
  let polls = 0;
  let mode = '';
  let child: any;

  const file = path.join(os.tmpdir(), `dsh-bl-clip-${process.pid}.txt`);
  const status = path.join(os.tmpdir(), `dsh-bl-clip-${process.pid}.status.json`);
  try { fs.writeFileSync(file, ''); } catch { /* ignore */ }

  // The plugin's own HTTP routes are fenced to the Electron renderer by
  // Desktop's `permits()`, so a plain browser (or a human) cannot read the
  // route's JSON to find out what went wrong. Mirroring the same snapshot to a
  // temp file keeps the feature diagnosable from outside the app entirely.
  let lastWrite = 0;
  const writeStatus = (force = false): void => {
    const now = Date.now();
    if (!force && now - lastWrite < 900) return;
    lastWrite = now;
    try {
      fs.writeFileSync(status, JSON.stringify({
        pid: process.pid, platform: process.platform, mode, available,
        lines, bytes, fileOk, polls, err, file, status,
      }, null, 2));
    } catch { /* ignore */ }
  };

  const platform = process.platform;
  let cmd = '';
  let args: string[] = [];

  /** Single-quote for PowerShell (literal string). */
  const psq = (s: string) => `'${s.replace(/'/g, "''")}'`;
  /** Single-quote for POSIX sh (literal string). */
  const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

  if (platform === 'win32') {
    cmd = 'powershell.exe';
    // -Sta matters: the Windows Forms clipboard requires a single-threaded
    // apartment. The script deliberately avoids depending on the
    // Microsoft.PowerShell.Management module (Get-Clipboard) because a host
    // process with a stripped environment may have no PSModulePath, in which
    // case module auto-loading fails and the loop would silently return ''.
    // We therefore load System.Windows.Forms directly and keep Get-Clipboard
    // only as a secondary path. Every failure is reported once on stderr so the
    // /bilingual-reader/clipboard diagnostic can explain itself.
    // NOTE: the script uses ONLY single-quoted PowerShell strings. A native
    // parent (Node/libuv) wraps this argv element in double quotes and escapes
    // any embedded `"` as `\"`, which PowerShell's `-Command` parser does not
    // reliably handle; keeping the text quote-free avoids that trap entirely.
    const pss = (s: string) => `'${s.replace(/'/g, "''")}'`;
    args = ['-NoProfile', '-NonInteractive', '-Sta', '-ExecutionPolicy', 'Bypass', '-Command',
      `$path=${psq(file)}; $reported=$false; $useForms=$false; ` +
      'try { Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop; $useForms=$true } ' +
      `catch { [Console]::Error.WriteLine(${pss('Forms load failed: ')}+$_.Exception.Message); [Console]::Error.Flush() }; ` +
      `[Console]::Error.WriteLine(${pss('mode=')}+$(if($useForms){${pss('forms')}}else{${pss('get-clipboard')}})); [Console]::Error.Flush(); ` +
      '$last=[string]::Empty; ' +
      'while($true){ $t=$null; ' +
      `if($useForms){ try{ $t=[System.Windows.Forms.Clipboard]::GetText() } catch { if(-not $reported){ $reported=$true; [Console]::Error.WriteLine(${pss('Forms read failed: ')}+$_.Exception.Message); [Console]::Error.Flush() } } }; ` +
      `if([string]::IsNullOrEmpty($t)){ try{ $t=Get-Clipboard -Raw -ErrorAction Stop } catch { if(-not $reported){ $reported=$true; [Console]::Error.WriteLine(${pss('Get-Clipboard failed: ')}+$_.Exception.Message); [Console]::Error.Flush() } } }; ` +
      'if($null -eq $t){$t=[string]::Empty}; ' +
      'if($t -ne $last){ $last=$t; $b=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($t)); ' +
      `try{ [IO.File]::WriteAllText($path,$b) }catch{}; ` +
      '[Console]::Out.WriteLine($b); [Console]::Out.Flush() }; Start-Sleep -Milliseconds 300 }'];
  } else if (platform === 'darwin') {
    cmd = '/bin/sh';
    args = ['-c', `last=''; while true; do t=$(pbpaste 2>/dev/null); if [ "$t" != "$last" ]; then last="$t"; b=$(printf '%s' "$t" | base64); printf '%s' "$b" > ${shq(file)}; printf '%s\\n' "$b"; fi; sleep 0.3; done`];
  } else {
    cmd = '/bin/sh';
    args = ['-c', `last=''; while true; do t=$(xclip -selection clipboard -o 2>/dev/null); if [ "$t" != "$last" ]; then last="$t"; b=$(printf '%s' "$t" | base64); printf '%s' "$b" > ${shq(file)}; printf '%s\\n' "$b"; fi; sleep 0.3; done`];
  }

  try {
    child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    available = true;
    child.on('error', (e: any) => { available = false; err = (err + ' | spawn error: ' + (e?.message ?? String(e))).slice(-600); writeStatus(true); });
    child.on('exit', (code: number) => { available = false; err = (err + ' | exit ' + code).slice(-600); writeStatus(true); });
    child.stderr?.on('data', (d: Buffer) => {
      err = (err + d.toString('utf8')).slice(-600);
      const m = /mode=(\S+)/.exec(err);
      if (m) mode = m[1];
      writeStatus(true);
    });
    child.stdout?.on('data', (d: Buffer) => {
      bytes += d.length;
      buf += d.toString('utf8');
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        try { text = Buffer.from(line, 'base64').toString('utf8'); lines++; writeStatus(true); } catch { /* ignore bad line */ }
      }
    });
  } catch (e: any) {
    available = false;
    err = (err + ' | spawn threw: ' + (e?.message ?? String(e))).slice(-600);
    writeStatus(true);
  }
  writeStatus(true);

  /** Mirror channel: the watcher writes the latest base64 into a temp file. */
  const readFile = (): string => {
    try {
      const b64 = fs.readFileSync(file, 'utf8').trim();
      if (!b64) return '';
      const s = Buffer.from(b64, 'base64').toString('utf8');
      if (s) { fileOk = true; return s; }
    } catch { /* ignore */ }
    return '';
  };

  return {
    read: () => text || readFile(),
    available: () => available,
    debug: () => {
      polls += 1;
      writeStatus();
      return { available, lines, bytes, fileOk, polls, mode, err, file, status };
    },
    dispose: () => {
      try { child?.kill(); } catch { /* ignore */ }
      // The mirror holds real clipboard text, so drop it; the status snapshot is
      // counters and error text only, and is deliberately left behind so the
      // last state survives a crash or a host restart for later inspection.
      try { fs.unlinkSync(file); } catch { /* ignore */ }
    },
  };
}
