import {
  useContext,
  useEffect,
  useRef,
} from 'react';

import Box from '@mui/material/Box';

import PubSubContext from '../../context/pubsub/context';
import { socketRequest } from '../../sockets';

/**
 * Full-screen layer that swallows the first tap in standby.
 *
 * The tap only sends ``display.activity``; it must not reach a button
 * underneath. The overlay stays until the state leaves ``standby``.
 */
const WakeOverlay = () => {
  const { state } = useContext(PubSubContext);
  const status = state?.['display.status'];
  const standby = status?.state === 'standby';
  const sent = useRef(false);

  useEffect(() => {
    if (!standby) {
      sent.current = false;
    }
  }, [standby]);

  if (!standby) {
    return null;
  }

  const swallow = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const wake = (event) => {
    swallow(event);
    if (sent.current) {
      return;
    }
    sent.current = true;
    socketRequest('display', 'activity', null, {}).catch(() => {});
  };

  return (
    <Box
      aria-hidden="true"
      data-testid="wake-overlay"
      role="presentation"
      onClick={swallow}
      onContextMenu={swallow}
      onPointerDown={wake}
      onPointerUp={swallow}
      sx={{
        backgroundColor: '#000',
        inset: 0,
        position: 'fixed',
        zIndex: 9999,
      }}
    />
  );
};

export default WakeOverlay;
