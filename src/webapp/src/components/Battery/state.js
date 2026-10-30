const STATE_KEYS = ['charging', 'discharging', 'idle'];

const batteryStateLabel = (t, state) => (
  STATE_KEYS.includes(state)
    ? t(`settings.status.battery.states.${state}`)
    : t('settings.status.battery.states.unknown')
);

const batteryDetails = (t, battery) => {
  const {
    voltage_v: voltage,
    current_ma: current,
    power_w: power,
  } = battery;

  if (![voltage, current, power].every(Number.isFinite)) {
    return null;
  }

  return t('settings.status.battery.details', {
    voltage: voltage.toFixed(2),
    current: (current / 1000).toFixed(2),
    power: power.toFixed(1),
  });
};

export {
  batteryDetails,
  batteryStateLabel,
};
