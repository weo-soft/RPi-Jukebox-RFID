import { useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  ListItem,
  ListItemText,
  ListItemAvatar,
  Avatar,
} from '@mui/material';

import BatteryIcon from '../../Battery/battery-icon';
import PubSubContext from '../../../context/pubsub/context';
import { batteryDetails, batteryStateLabel } from '../../Battery/state';
import { pluginIsLoaded } from '../../../utils/utils';

const StatusBattery = () => {
  const { t } = useTranslation();

  const { state: {
    'core.plugins.loaded': plugins,
    'batt_status': battery,
  } } = useContext(PubSubContext);

  const [batteryPluginAvailable, setBatteryPluginAvailability] = useState(false);

  useEffect(() => {
    if (pluginIsLoaded(plugins, 'battmon')) {
      setBatteryPluginAvailability(true);
    }
  }, [plugins]);

  if (!batteryPluginAvailable) {
    return null;
  }

  const available = battery?.available === true;
  const soc = available && typeof battery.soc === 'number' ? battery.soc : null;
  const details = available ? batteryDetails(t, battery) : null;

  let primary;
  let secondary;
  if (!battery) {
    primary = `${t('general.loading')} ...`;
    secondary = t('settings.status.battery.title');
  } else if (!available || soc === null) {
    primary = t('settings.status.battery.unavailable');
    secondary = t('settings.status.battery.title');
  } else {
    primary = `${soc}%`;
    secondary = batteryStateLabel(t, battery.state);
  }

  return (
    <ListItem disableGutters>
      <ListItemAvatar>
        <Avatar>
          <BatteryIcon
            charging={available && battery?.charging === true}
            soc={soc ?? undefined}
          />
        </Avatar>
      </ListItemAvatar>
      <ListItemText
        primary={primary}
        secondary={details ? <>{secondary}<br />{details}</> : secondary}
      />
    </ListItem>
  );
};

export default StatusBattery;
