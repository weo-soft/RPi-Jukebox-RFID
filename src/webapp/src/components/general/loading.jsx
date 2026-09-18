import { useTranslation } from 'react-i18next';

import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';

/*
 * Loading state of a view. The block is as tall as the area the content will
 * take - the inner height minus the header and the action bar - so the spinner
 * sits where the eye waits for the entries instead of in a corner, and the size
 * reads from across the room.
 */
const Loading = () => {
  const { t } = useTranslation();

  return (
    <Box
      data-testid="view-loading"
      sx={{
        alignItems: 'center',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-4)',
        justifyContent: 'center',
        minHeight: 'calc(100dvh - var(--nav-height) - 2 * var(--gutter) - 7rem)',
        width: '100%',
      }}
    >
      <CircularProgress size={64} />
      <Typography color="textSecondary" variant="contentBody">
        {t('general.loading')}
      </Typography>
    </Box>
  );
};

export default Loading;
