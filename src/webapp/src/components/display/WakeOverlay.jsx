import {
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

import Box from '@mui/material/Box';

import PubSubContext from '../../context/pubsub/context';
import { socketRequest } from '../../sockets';

/**
 * Full-screen layer that swallows the first tap in standby.
 *
 * The tap only sends ``display.activity``; it must not reach a button
 * underneath. The overlay also stays briefly after the state leaves
 * ``standby``, so the pointerup and click of the waking tap are swallowed.
 */
const RELEASE_DELAY_MS = 600;

const WakeOverlay = () => {
  const { state } = useContext(PubSubContext);
  const status = state?.['display.status'];
  const standby = status?.state === 'standby';
  const sent = useRef(false);
  const wasStandby = useRef(false);
  const [releaseVisible, setReleaseVisible] = useState(false);

  useEffect(() => {
    if (standby) {
      sent.current = false;
      wasStandby.current = true;
      setReleaseVisible(true);
      return undefined;
    }
    if (!wasStandby.current) {
      return undefined;
    }
    const timer = setTimeout(() => {
      wasStandby.current = false;
      setReleaseVisible(false);
    }, RELEASE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [standby]);

  const visible = standby || (wasStandby.current && releaseVisible);

  if (!visible) {
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
        backgroundColor: standby ? '#000' : 'transparent',
        inset: 0,
        position: 'fixed',
        zIndex: 9999,
      }}
    />
  );
};

export default WakeOverlay;
