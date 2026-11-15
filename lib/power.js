import { spawn } from "node:child_process";
import os from "node:os";

let inhibitor = null;
export function powerStatus() { return { supported: ["win32", "darwin", "linux"].includes(process.platform), active: Boolean(inhibitor), platform: process.platform }; }
export function setPowerInhibit(enabled) {
  if (!enabled) { if (inhibitor) { inhibitor.kill(); inhibitor = null; } return powerStatus(); }
  if (inhibitor && inhibitor.exitCode === null) return powerStatus();
  const platform = os.platform();
  if (platform === "win32") {
    const script = "$sig='[DllImport(\"kernel32.dll\", SetLastError=true)] public static extern uint SetThreadExecutionState(uint flags);'; Add-Type -MemberDefinition $sig -Name Native -Namespace FnOPower; while ($true) { [FnOPower.Native]::SetThreadExecutionState(0x80000001) | Out-Null; Start-Sleep -Seconds 25 }";
    inhibitor = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, stdio: "ignore" });
  } else if (platform === "darwin") {
    inhibitor = spawn("caffeinate", ["-dimsu"], { stdio: "ignore" });
  } else if (platform === "linux") {
    inhibitor = spawn("systemd-inhibit", ["--what=sleep", "--mode=block", "--why=FnOPredictor monitoring is active", "sh", "-c", "while :; do sleep 3600; done"], { stdio: "ignore" });
  }
  inhibitor?.on("exit", () => { inhibitor = null; });
  return powerStatus();
}
export function releasePowerInhibit() { if (inhibitor) inhibitor.kill(); inhibitor = null; }
