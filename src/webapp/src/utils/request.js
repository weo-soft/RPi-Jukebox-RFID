import { socketRequest } from "../sockets";
import commands from "../commands";
import { PASSIVE_COMMANDS } from "../sockets/activity-commands";

const ACTIVITY_THROTTLE_MS = 1000;
let lastActivityPing = 0;

const request = async (command, kwargs = {}) => {
  try {
    if (!(command in commands)) {
      throw new Error(`'${command}' does not exist in command object`);
    }

    const { _package, plugin, method = null } = commands[command];

    // Send request
    const result = await socketRequest(_package, plugin, method, kwargs);

    if (
      _package !== 'display' &&
      !PASSIVE_COMMANDS.has(command) &&
      Date.now() - lastActivityPing >= ACTIVITY_THROTTLE_MS
    ) {
      lastActivityPing = Date.now();
      socketRequest('display', 'activity', null, {}).catch(() => {});
    }

    return { result };
  }
  catch (error) {
    console.error(`${command}: `, error);
    return { error };
  };
};

export default request;
