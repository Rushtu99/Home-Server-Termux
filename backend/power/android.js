const fs = require('fs');
const { execFileSync } = require('child_process');

const commandJson = (command) => {
  try {
    return JSON.parse(execFileSync(command, { encoding: 'utf8', timeout: 3000 }));
  } catch {
    return null;
  }
};

const commandExists = (command) => {
  try {
    execFileSync('sh', ['-c', `command -v ${command} >/dev/null 2>&1`], { timeout: 1000 });
    return true;
  } catch {
    return false;
  }
};

const getThermalZones = () => {
  try {
    if (!fs.existsSync('/sys/class/thermal')) return [];
    return fs.readdirSync('/sys/class/thermal')
      .filter((entry) => entry.startsWith('thermal_zone'))
      .map((entry) => {
        const tempPath = `/sys/class/thermal/${entry}/temp`;
        try {
          const milliC = Number(fs.readFileSync(tempPath, 'utf8').trim());
          return Number.isFinite(milliC) ? { milliC, name: entry } : null;
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
};

const getAndroidPowerState = () => {
  const battery = commandExists('termux-battery-status') ? commandJson('termux-battery-status') : null;
  const thermalZones = getThermalZones();
  const maxTempC = thermalZones.length > 0
    ? Math.max(...thermalZones.map((entry) => entry.milliC / 1000))
    : null;
  return {
    androidApiAvailable: commandExists('termux-battery-status') || commandExists('termux-wake-lock'),
    batteryPct: Number.isFinite(Number(battery?.percentage)) ? Number(battery.percentage) : null,
    charging: typeof battery?.status === 'string' ? ['charging', 'full'].includes(battery.status.toLowerCase()) : null,
    rawBattery: battery,
    thermal: {
      maxTempC,
      throttlingLikely: maxTempC !== null ? maxTempC >= 45 : null,
      zones: thermalZones,
    },
    wakeLockAvailable: commandExists('termux-wake-lock'),
  };
};

const shouldBlockHeavyService = ({ descriptor = {}, minBatteryPct = 15, maxTempC = 48 } = {}) => {
  const power = getAndroidPowerState();
  const heavy = String(descriptor.powerProfile || descriptor.power?.profile || '').toLowerCase() === 'heavy';
  if (!heavy) return { blocked: false, power };
  if (power.thermal.maxTempC !== null && power.thermal.maxTempC >= maxTempC) {
    return {
      blocked: true,
      power,
      reason: `thermal ${power.thermal.maxTempC.toFixed(1)}C is above ${maxTempC}C`,
    };
  }
  if (power.batteryPct === null || power.charging === true) return { blocked: false, power };
  return {
    blocked: power.batteryPct < minBatteryPct,
    power,
    reason: `battery ${power.batteryPct}% is below ${minBatteryPct}%`,
  };
};

module.exports = {
  getAndroidPowerState,
  shouldBlockHeavyService,
};
