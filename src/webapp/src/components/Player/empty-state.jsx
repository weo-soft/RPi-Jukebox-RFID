import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';

const EmptyState = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-4)',
        minWidth: 0,
      }}
    >
      <Box>
        <Typography component="h5" variant="displayTitle">
          {t('player.empty.title')}
        </Typography>
        <Typography
          color="textSecondary"
          component="p"
          sx={{ margin: 0, marginTop: 'var(--space-2)' }}
          variant="displaySubtitle"
        >
          {t('player.empty.hint')}
        </Typography>
      </Box>
      <Box>
        <Button
          onClick={() => navigate('/library')}
          sx={{ minHeight: 'var(--touch-comfort)', paddingX: 'var(--space-6)' }}
          variant="contained"
        >
          {t('player.empty.open-library')}
        </Button>
      </Box>
    </Box>
  );
};

export default EmptyState;
