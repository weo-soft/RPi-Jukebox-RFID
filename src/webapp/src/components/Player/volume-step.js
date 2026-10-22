const VOLUME_STEP = 5;

/*
 * The buttons move in whole steps. An off-step current value is moved to the
 * next step in the requested direction: 42 + 5 -> 45, 42 - 5 -> 40.
 */
const nextVolume = (current, direction, max = 100) => {
  if (direction > 0) {
    return Math.min(
      max,
      Math.floor(current / VOLUME_STEP) * VOLUME_STEP + VOLUME_STEP,
    );
  }

  return Math.max(
    0,
    Math.ceil(current / VOLUME_STEP) * VOLUME_STEP - VOLUME_STEP,
  );
};

export { VOLUME_STEP, nextVolume };
