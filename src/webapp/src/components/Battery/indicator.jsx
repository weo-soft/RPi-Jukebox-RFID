import { useContext, useEffect, useState } from 'react';
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

const EDGE_GAP = 8;

// The indicator floats above the content column. Its right edge follows the
// main region of the current shell, so the position holds for a centered
// column as well as for a full width layout.
const useContentEdge = () => {
  const [right, setRight] = useState(EDGE_GAP);

  useEffect(() => {
    const update = () => {
      const main = document.querySelector('main');
      if (!main) {
        return;
      }
      const distance = window.innerWidth - main.getBoundingClientRect().right;
      setRight(Math.max(EDGE_GAP, Math.round(distance) + EDGE_GAP));
    };

    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return right;
};

const BatteryIndicator = () => {
  const { t } = useTranslation();
  const theme = useTheme();
  const right = useContentEdge();

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
          minHeight: 48,
          minWidth: 48,
          paddingLeft: 1,
          paddingRight: 0.5,
          paddingY: 0.5,
          position: 'fixed',
          right: `${right}px`,
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
