import { useContext } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import {
  ButtonBase,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';

import BatteryIcon from './battery-icon';
import PubSubContext from '../../context/pubsub/context';
import { batteryDetails, batteryStateLabel } from './state';

const BatteryIndicator = () => {
  const { t } = useTranslation();
  const theme = useTheme();

  const { state: {
    'batt_status': battery,
  } } = useContext(PubSubContext);

  if (!battery || battery.available !== true || typeof battery.soc !== 'number') {
    return null;
  }

  const { soc, charging, state } = battery;
  const stateLabel = batteryStateLabel(t, state);
  const details = batteryDetails(t, battery);
  const tooltip = [stateLabel, details].filter(Boolean).join(' · ');

  return (
    <Tooltip title={tooltip}>
      <ButtonBase
        aria-label={t('settings.status.battery.indicator.aria-label', { soc, state: stateLabel })}
        component={Link}
        nativeButton={false}
        sx={{
          alignItems: 'center',
          backgroundColor: alpha(theme.palette.background.paper, 0.6),
          backdropFilter: 'blur(4px)',
          borderRadius: 2,
          display: 'flex',
          gap: 0.5,
          paddingLeft: 1,
          paddingRight: 0.5,
          paddingY: 0.5,
          position: 'fixed',
          right: { xs: '8px', md: 'calc(25vw + 8px)' },
          top: '8px',
          zIndex: 1100,
        }}
        to="/settings"
      >
        <BatteryIcon charging={charging} soc={soc} />
        <Typography variant="body2">{`${soc}%`}</Typography>
      </ButtonBase>
    </Tooltip>
  );
};

export default BatteryIndicator;
