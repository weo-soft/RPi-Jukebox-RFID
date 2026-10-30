/*
 * Labels shared by the MCP23017 settings list and its assignment dialog.
 */
export const actionLabel = (t, action) => {
  const label = t(`settings.mcp23017.actions.${action.id}`, {
    defaultValue: action.label,
  });
  return action.danger ? `${label} ⚠` : label;
};

export const assignedActionLabel = (t, pin, actions) => {
  if (!pin.action_id) {
    return t('settings.mcp23017.advanced-label', { type: pin.type });
  }
  const action = actions.find(entry => entry.id === pin.action_id);
  return action ? actionLabel(t, action) : pin.action_id;
};
